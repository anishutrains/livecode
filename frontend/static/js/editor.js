let editor = null;
let currentClassId = null;
let saveTimeout = null;
let classesMap = new Map();

// Add theme definitions
const editorThemes = {
    dracula: {
        base: 'vs-dark',
        inherit: true,
        rules: [
            { token: 'comment', foreground: '6272a4' },
            { token: 'keyword', foreground: 'ff79c6' },
            { token: 'string', foreground: 'f1fa8c' },
            { token: 'number', foreground: 'bd93f9' },
            { token: 'function', foreground: '50fa7b' },
            { token: 'class', foreground: '8be9fd' },
            { token: 'variable', foreground: 'f8f8f2' },
            { token: 'operator', foreground: 'ff79c6' },
            { token: 'type', foreground: '8be9fd' }
        ],
        colors: {
            'editor.background': '#282a36',
            'editor.foreground': '#f8f8f2',
            'editor.lineHighlightBackground': '#44475a',
            'editorCursor.foreground': '#f8f8f2',
            'editor.selectionBackground': '#44475a',
            'editor.inactiveSelectionBackground': '#44475a',
            'editorLineNumber.foreground': '#6272a4',
            'editorLineNumber.activeForeground': '#f8f8f2',
            'editorGutter.background': '#282a36',
            'editorGutter.modifiedBackground': '#ffb86c',
            'editorGutter.addedBackground': '#50fa7b',
            'editorGutter.deletedBackground': '#ff5555'
        }
    },
    monokai: {
        base: 'vs-dark',
        inherit: true,
        rules: [
            { token: 'comment', foreground: '75715e' },
            { token: 'keyword', foreground: 'f92672' },
            { token: 'string', foreground: 'e6db74' },
            { token: 'number', foreground: 'ae81ff' },
            { token: 'function', foreground: 'a6e22e' },
            { token: 'class', foreground: '66d9ef' },
            { token: 'variable', foreground: 'f8f8f2' },
            { token: 'operator', foreground: 'f92672' },
            { token: 'type', foreground: '66d9ef' }
        ],
        colors: {
            'editor.background': '#272822',
            'editor.foreground': '#f8f8f2',
            'editor.lineHighlightBackground': '#3e3d32',
            'editorCursor.foreground': '#f8f8f2',
            'editor.selectionBackground': '#49483e',
            'editor.inactiveSelectionBackground': '#49483e',
            'editorLineNumber.foreground': '#75715e',
            'editorLineNumber.activeForeground': '#f8f8f2',
            'editorGutter.background': '#272822',
            'editorGutter.modifiedBackground': '#fd971f',
            'editorGutter.addedBackground': '#a6e22e',
            'editorGutter.deletedBackground': '#f92672'
        }
    }
};

// Initialize editor page
document.addEventListener('DOMContentLoaded', () => {
    initializeTheme();
    initializeEditor();
    initializeEventListeners();
    initializeUI();
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

        // Register custom themes
        monaco.editor.defineTheme('dracula', editorThemes.dracula);
        monaco.editor.defineTheme('monokai', editorThemes.monokai);

        // Get saved theme or default to vs-dark
        const savedTheme = localStorage.getItem('editorTheme') || 'vs-dark';
        editor = monaco.editor.create(document.getElementById('editor'), {
            value: '',
            language: 'plaintext',
            theme: savedTheme,
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
            autoIndent: 'full',
            bracketPairColorization: {
                enabled: true
            },
            guides: {
                indentation: true,
                bracketPairs: true
            }
        });

        // Set initial theme in selector
        document.getElementById('themeSelect').value = savedTheme;

        // Theme selection handler
        document.getElementById('themeSelect').addEventListener('change', (e) => {
            const theme = e.target.value;
            monaco.editor.setTheme(theme);
            localStorage.setItem('editorTheme', theme);
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
        <div class="d-flex justify-content-between align-items-start">
            <div class="class-info flex-grow-1" onclick="selectClass('${classItem.classroom_id}')">
                <div class="fw-bold class-name">${classItem.class_name}</div>
                <small class="text-muted">Last updated: ${lastUpdated}</small>
            </div>
            <div class="class-actions">
                <button class="btn btn-sm btn-outline-primary me-1" onclick="editClassName('${classItem.classroom_id}')">
                    <i class="bi bi-pencil"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger" onclick="deleteClass('${classItem.classroom_id}')">
                    <i class="bi bi-trash"></i>
                </button>
            </div>
        </div>
    `;

    classListElement.appendChild(div);
}


// Add these new functions for editing and deleting classes
async function editClassName(classId) {
    const classData = classesMap.get(classId);
    if (!classData) return;

    // Show edit modal
    const modal = new bootstrap.Modal(document.getElementById('editClassModal'));
    document.getElementById('editClassName').value = classData.class_name;
    document.getElementById('editClassId').value = classId;
    modal.show();
}

async function saveClassName() {
    const classId = document.getElementById('editClassId').value;
    const newClassName = document.getElementById('editClassName').value.trim();
    
    if (!newClassName) {
        showToast('Class name cannot be empty', 'error');
        return;
    }

    try {
        const response = await fetch(`/api/classes/${classId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                class_name: newClassName
            })
        });

        if (response.ok) {
            // Update local data
            const classData = classesMap.get(classId);
            if (classData) {
                classData.class_name = newClassName;
            }

            // Close modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('editClassModal'));
            modal.hide();

            // Refresh class list
            await loadClassList();
            
            showToast('Class name updated successfully', 'success');
        } else {
            throw new Error('Failed to update class name');
        }
    } catch (error) {
        console.error('Failed to update class name:', error);
        showToast('Failed to update class name', 'error');
    }
}

async function deleteClass(classId) {
    const classData = classesMap.get(classId);
    if (!classData) return;

    // Show confirmation modal
    const modal = new bootstrap.Modal(document.getElementById('deleteClassModal'));
    document.getElementById('deleteClassName').textContent = classData.class_name;
    document.getElementById('deleteClassId').value = classId;
    modal.show();
}

async function confirmDeleteClass() {
    const classId = document.getElementById('deleteClassId').value;
    
    try {
        const response = await fetch(`/api/classes/${classId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            // Remove from local data
            classesMap.delete(classId);

            // Close modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('deleteClassModal'));
            modal.hide();

            // If this was the current class, clear editor
            if (currentClassId === classId) {
                currentClassId = null;
                editor.setValue('');
                editor.updateOptions({ readOnly: true });
                document.getElementById('current-class-title').textContent = 'Select a Class';
                document.getElementById('share-btn').disabled = true;
            }

            // Refresh class list
            await loadClassList();
            
            showToast('Class deleted successfully', 'success');
        } else {
            throw new Error('Failed to delete class');
        }
    } catch (error) {
        console.error('Failed to delete class:', error);
        showToast('Failed to delete class', 'error');
    }
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

        // Update active state in class list
        document.querySelectorAll('.class-list-item').forEach(item => {
            item.classList.remove('active');
            if (item.getAttribute('data-class-id') === classId) {
                item.classList.add('active');
            }
        });

        // Enable editor
        editor.updateOptions({ readOnly: false });

        // Show loading state
        editor.setValue('Loading...');

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

        // Update last accessed time
        classData.last_accessed = new Date().toISOString();
        await loadClassList();
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
        updateSaveStatus('Saving...');

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
            updateSaveStatus('All changes saved');
            
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
    const toast = document.createElement('div');
    toast.className = `toast align-items-center text-white bg-${type} border-0`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'assertive');
    toast.setAttribute('aria-atomic', 'true');
    
    toast.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">
                ${message}
            </div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
        </div>
    `;
    
    document.body.appendChild(toast);
    const bsToast = new bootstrap.Toast(toast);
    bsToast.show();
    
    toast.addEventListener('hidden.bs.toast', () => {
        toast.remove();
    });
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

function initializeUI() {
    // Set user email in header
    const userEmail = sessionStorage.getItem('userEmail') || 'User';
    document.getElementById('userEmail').textContent = userEmail;

    // Initialize tooltips
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });

    // Initialize search functionality
    document.getElementById('searchClasses').addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const classItems = document.querySelectorAll('.class-list-item');
        
        classItems.forEach(item => {
            const className = item.querySelector('.fw-bold').textContent.toLowerCase();
            item.style.display = className.includes(searchTerm) ? 'block' : 'none';
        });
    });

    // Initialize fullscreen functionality
    document.getElementById('fullscreen-btn').addEventListener('click', () => {
        const editorContainer = document.querySelector('.editor-container');
        if (!document.fullscreenElement) {
            editorContainer.requestFullscreen();
            document.getElementById('fullscreen-btn').innerHTML = '<i class="bi bi-arrows-angle-contract"></i>';
        } else {
            document.exitFullscreen();
            document.getElementById('fullscreen-btn').innerHTML = '<i class="bi bi-arrows-angle-expand"></i>';
        }
    });

    // Handle fullscreen change
    document.addEventListener('fullscreenchange', () => {
        const btn = document.getElementById('fullscreen-btn');
        btn.innerHTML = document.fullscreenElement ? 
            '<i class="bi bi-arrows-angle-contract"></i>' : 
            '<i class="bi bi-arrows-angle-expand"></i>';
    });

    // Initialize theme selector
    const themeSelect = document.getElementById('themeSelect');
    const savedTheme = localStorage.getItem('editorTheme') || 'vs-dark';
    themeSelect.value = savedTheme;
}

// Update the save status display
function updateSaveStatus(status) {
    const saveStatus = document.getElementById('save-status');
    saveStatus.textContent = status;
    saveStatus.classList.add('visible');
    
    if (status === 'All changes saved') {
        setTimeout(() => {
            saveStatus.classList.remove('visible');
        }, 2000);
    }
} 