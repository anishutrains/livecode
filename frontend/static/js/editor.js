let editor = null;
let currentClassId = null;
let saveTimeout = null;
let classesMap = new Map();

// Initialize editor page
document.addEventListener('DOMContentLoaded', () => {
    initializeTheme();
    initializeEditor();
    initializeEventListeners();
    loadClassList();
    checkSession();
});

function initializeTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    document.getElementById('theme-toggle').checked = savedTheme === 'dark';
}

function initializeEditor() {
    require(['vs/editor/editor.main'], function() {
        editor = monaco.editor.create(document.getElementById('editor'), {
            value: '',
            language: 'plaintext',
            theme: 'vs-dark',
            automaticLayout: true,
            minimap: { enabled: true },
            fontSize: 14,
            lineNumbers: 'on',
            renderIndentGuides: true,
            tabSize: 4,
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            formatOnType: true,
            formatOnPaste: true,
            suggestOnTriggerCharacters: true,
            snippetSuggestions: 'inline',
            folding: true,
            autoIndent: 'full'
        });

        // Language selection handler
        document.getElementById('languageSelect').addEventListener('change', (e) => {
            const language = e.target.value;
            monaco.editor.setModelLanguage(editor.getModel(), language);
            
            // Set language-specific settings
            const settings = getLanguageSettings(language);
            editor.updateOptions(settings);
        });

        // Auto-save on content change
        editor.onDidChangeModelContent(() => {
            if (saveTimeout) clearTimeout(saveTimeout);
            document.getElementById('save-status').textContent = 'Saving...';
            
            saveTimeout = setTimeout(() => {
                if (currentClassId) {
                    updateNotes();
                }
            }, 1000);
        });

        // Disable editor initially
        editor.updateOptions({ readOnly: true });
    });
}

function getLanguageSettings(language) {
    const baseSettings = {
        tabSize: 4,
        insertSpaces: true,
        autoIndent: 'full',
        formatOnType: true
    };

    const languageSettings = {
        python: {
            ...baseSettings,
            tabSize: 4,
            insertSpaces: true
        },
        javascript: {
            ...baseSettings,
            tabSize: 2,
            insertSpaces: true
        },
        java: {
            ...baseSettings,
            tabSize: 4,
            insertSpaces: true
        },
        cpp: {
            ...baseSettings,
            tabSize: 4,
            insertSpaces: true
        }
    };

    return languageSettings[language] || baseSettings;
}

function initializeEventListeners() {
    document.getElementById('create-class-btn').addEventListener('click', showCreateClassModal);
    document.getElementById('confirmCreateClass').addEventListener('click', createNewClass);
    document.getElementById('logout-btn').addEventListener('click', handleLogout);
    document.getElementById('share-btn').addEventListener('click', showShareModal);
    document.getElementById('modal-copy-btn').addEventListener('click', copyModalShareUrl);
    
    // Theme toggle
    document.getElementById('theme-toggle').addEventListener('change', (e) => {
        const theme = e.target.checked ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    });
}

// Load existing classes
async function loadClassList() {
    try {
        const response = await fetch('/api/classes');
        const classes = await response.json();
        
        const classListElement = document.getElementById('class-list');
        classListElement.innerHTML = '';
        
        if (classes.length === 0) {
            classListElement.innerHTML = `
                <div class="p-3 text-center text-muted">
                    No classes yet. Create your first class!
                </div>
            `;
            return;
        }

        classes.forEach(classItem => {
            classesMap.set(classItem.classroom_id, classItem);
            addClassToList(classItem);
        });
    } catch (error) {
        console.error('Failed to load classes:', error);
        showToast('Error loading classes', 'error');
    }
}

// Add class to the list
function addClassToList(classItem) {
    const classListElement = document.getElementById('class-list');
    const div = document.createElement('div');
    div.className = 'class-list-item';
    div.setAttribute('data-class-id', classItem.classroom_id);
    
    const lastUpdated = new Date(classItem.last_updated).toLocaleString();
    
    div.innerHTML = `
        <div class="d-flex flex-column">
            <div class="fw-bold">${classItem.class_name}</div>
            <small class="text-muted">Last updated: ${lastUpdated}</small>
        </div>
    `;

    div.addEventListener('click', () => selectClass(classItem.classroom_id));
    classListElement.appendChild(div);
}

// Show create class modal
function showCreateClassModal() {
    const modal = new bootstrap.Modal(document.getElementById('createClassModal'));
    modal.show();
}

// Create new class
async function createNewClass() {
    const className = document.getElementById('className').value.trim();
    if (!className) {
        showToast('Please enter a class name', 'error');
        return;
    }

    const classId = 'class-' + Date.now();
    const newClass = {
        classroom_id: classId,
        class_name: className,
        content: '',
        last_updated: new Date().toISOString()
    };
    
    try {
        const response = await fetch(`/api/notes/${classId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
                content: '',
                class_name: className 
            })
        });
        
        if (response.ok) {
            classesMap.set(classId, newClass);
            addClassToList(newClass);
            selectClass(classId);
            showToast('New class created successfully', 'success');
            
            // Close the modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('createClassModal'));
            modal.hide();
            
            // Clear the input
            document.getElementById('className').value = '';
        }
    } catch (error) {
        console.error('Failed to create new class:', error);
        showToast('Failed to create new class', 'error');
    }
}

// Select class
async function selectClass(classId) {
    try {
        currentClassId = classId;
        const classData = classesMap.get(classId);

        // Update UI
        document.getElementById('current-class-title').textContent = classData.class_name;
        document.getElementById('share-btn').disabled = false;

        // Enable editor
        editor.updateOptions({ readOnly: false });

        // Load notes
        const response = await fetch(`/api/notes/${classId}`);
        const data = await response.json();

        if (data.content) {
            try {
                const content = JSON.parse(data.content);
                editor.setValue(content.text || '');
                
                // Set language if present
                if (content.language) {
                    document.getElementById('languageSelect').value = content.language;
                    monaco.editor.setModelLanguage(editor.getModel(), content.language);
                }
            } catch (e) {
                editor.setValue(data.content);
            }
        } else {
            editor.setValue('');
        }
    } catch (error) {
        console.error('Failed to load notes:', error);
        showToast('Failed to load notes', 'error');
    }
}

// Update notes
async function updateNotes() {
    if (!currentClassId) return;
    
    try {
        const content = {
            text: editor.getValue(),
            language: document.getElementById('languageSelect').value
        };

        const classData = classesMap.get(currentClassId);

        const response = await fetch(`/api/notes/${currentClassId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                content: JSON.stringify(content),
                class_name: classData.class_name
            })
        });

        if (response.ok) {
            document.getElementById('save-status').textContent = 'All changes saved';
            setTimeout(() => {
                document.getElementById('save-status').textContent = '';
            }, 2000);
            
            if (classData) {
                classData.last_updated = new Date().toISOString();
                await loadClassList();
            }
        }
    } catch (error) {
        console.error('Failed to save:', error);
        showToast('Failed to save changes', 'error');
    }
}

// Show share modal
function showShareModal() {
    if (!currentClassId) return;
    
    const shareUrl = `${window.location.origin}/view/${currentClassId}`;
    document.getElementById('modal-share-url').value = shareUrl;
    
    // Generate QR code
    const qrContainer = document.querySelector('.qr-code-container');
    qrContainer.innerHTML = '';
    QRCode.toCanvas(qrContainer, shareUrl, { width: 200 }, function (error) {
        if (error) console.error(error);
    });
    
    const modal = new bootstrap.Modal(document.getElementById('shareModal'));
    modal.show();
}

// Copy modal share URL
function copyModalShareUrl() {
    const modalShareUrl = document.getElementById('modal-share-url');
    modalShareUrl.select();
    document.execCommand('copy');
    
    const button = document.getElementById('modal-copy-btn');
    const originalText = button.innerHTML;
    button.innerHTML = '<i class="bi bi-check"></i> Copied!';
    setTimeout(() => {
        button.innerHTML = originalText;
    }, 2000);
}

function showToast(message, type = 'info') {
    // You can implement a toast notification system here
    console.log(`${type}: ${message}`);
}

// Handle logout
function handleLogout() {
    window.location.href = '/login';
}

function handleError(error) {
    console.error('Error:', error);
    // Show error to user
    alert('An error occurred. Please try again.');
}

async function login() {
    try {
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.message || 'Login failed');
        }

        if (data.status === 'success') {
            window.location.href = '/editor';
        } else {
            throw new Error(data.message);
        }
    } catch (error) {
        handleError(error);
    }
}

async function checkSession() {
    try {
        const response = await fetch('/api/check-session', {
            credentials: 'include'
        });
        if (!response.ok) {
            window.location.href = '/login';
        }
    } catch (error) {
        console.error('Session check failed:', error);
        window.location.href = '/login';
    }
}

// Check session every 5 minutes
setInterval(checkSession, 300000);

// Check session on page load
document.addEventListener('DOMContentLoaded', checkSession); 