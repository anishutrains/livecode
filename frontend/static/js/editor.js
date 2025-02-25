let currentClassId = null;
let saveTimeout = null;
let classesMap = new Map();
let quill = null;
let editor = document.getElementById('editor');
let languageSelect = document.getElementById('languageSelect');
let currentLanguage = 'plaintext';

// Initialize editor page
document.addEventListener('DOMContentLoaded', () => {
    initializeTheme();
    initializeQuill();
    initializeEventListeners();
    loadClassList();
});

function initializeTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    document.getElementById('theme-toggle').checked = savedTheme === 'dark';
}

function initializeQuill() {
    const toolbarOptions = [
        ['bold', 'italic', 'underline', 'strike'],
        ['blockquote', 'code-block'],
        [{ 'header': 1 }, { 'header': 2 }],
        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
        [{ 'script': 'sub'}, { 'script': 'super' }],
        [{ 'indent': '-1'}, { 'indent': '+1' }],
        [{ 'direction': 'rtl' }],
        [{ 'size': ['small', false, 'large', 'huge'] }],
        [{ 'header': [1, 2, 3, 4, 5, 6, false] }],
        [{ 'color': [] }, { 'background': [] }],
        [{ 'font': [] }],
        [{ 'align': [] }],
        ['clean']
    ];

    quill = new Quill('#editor', {
        theme: 'snow',
        modules: {
            toolbar: toolbarOptions
        },
        placeholder: 'Select a class to start taking notes...'
    });

    quill.disable();

    quill.on('text-change', () => {
        if (saveTimeout) clearTimeout(saveTimeout);
        document.getElementById('save-status').textContent = 'Saving...';
        
        saveTimeout = setTimeout(() => {
            if (currentClassId) {
                updateNotes();
            }
        }, 1000);
    });
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

    // Handle language selection
    languageSelect.addEventListener('change', (e) => {
        currentLanguage = e.target.value;
        highlightCode();
    });

    // Handle editor input
    let timeout;
    editor.addEventListener('input', () => {
        // Store cursor position
        let selection = window.getSelection();
        let range = selection.getRangeAt(0);
        let start = range.startOffset;
        
        // Debounce highlighting to improve performance
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            highlightCode();
            
            // Restore cursor position
            let newRange = document.createRange();
            newRange.setStart(editor.firstChild || editor, Math.min(start, editor.textContent.length));
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);
        }, 200);

        // Send updates to server
        sendUpdate(editor.innerText);
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
    currentClassId = classId;
    const classData = classesMap.get(classId);
    
    // Update UI
    document.getElementById('current-class-title').textContent = classData.class_name;
    document.getElementById('share-btn').disabled = false;
    quill.enable();
    
    // Update active class in sidebar
    document.querySelectorAll('.class-list-item').forEach(item => {
        item.classList.remove('active');
        if (item.getAttribute('data-class-id') === classId) {
            item.classList.add('active');
        }
    });
    
    try {
        const response = await fetch(`/api/notes/${classId}`);
        const data = await response.json();
        
        if (data.content) {
            try {
                // Try to parse as new format
                const content = JSON.parse(data.content);
                if (content.delta) {
                    quill.setContents(content.delta);
                } else if (content.text) {
                    quill.setText(content.text);
                }
            } catch (e) {
                // Fallback for old format or plain text
                quill.setText(data.content);
            }
        } else {
            quill.setText('');
        }
    } catch (error) {
        console.error('Failed to fetch notes:', error);
        showToast('Failed to load notes', 'error');
    }
}

// Update notes
async function updateNotes() {
    if (!currentClassId) return;
    
    try {
        // Get the content as plain text for backwards compatibility
        const plainText = quill.getText();
        // Get the delta for rich text
        const delta = quill.getContents();
        
        const content = {
            text: plainText,
            delta: delta
        };

        // Get the current class data
        const classData = classesMap.get(currentClassId);

        const response = await fetch(`/api/notes/${currentClassId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
                content: JSON.stringify(content),
                class_name: classData.class_name // Include the class name in every update
            })
        });
        
        if (response.ok) {
            document.getElementById('save-status').textContent = 'All changes saved';
            setTimeout(() => {
                document.getElementById('save-status').textContent = '';
            }, 2000);
            
            // Update last modified time in the list
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

// Function to highlight code
function highlightCode() {
    let code = editor.innerText;
    let highlighted = Prism.highlight(code, Prism.languages[currentLanguage], currentLanguage);
    editor.innerHTML = highlighted;
}

// Function to send updates to server
function sendUpdate(content) {
    fetch('/api/update_notes', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            content: content,
            language: currentLanguage,
            classroom_id: getClassroomId()
        })
    });
} 