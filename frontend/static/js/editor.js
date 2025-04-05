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

// Add these code organization features and formatting utilities

const formatOperations = {
    heading: (level) => {
        const selection = editor.getSelection();
        const prefix = '#'.repeat(level) + ' ';
        
        // Get the line content
        const lineNumber = selection.startLineNumber;
        const lineContent = editor.getModel().getLineContent(lineNumber);
        
        if (lineContent.trim().startsWith('#')) {
            // Replace existing heading
            const match = lineContent.match(/^(#+)\s/);
            if (match) {
                const startPosition = { lineNumber, column: 1 };
                const endPosition = { lineNumber, column: match[0].length + 1 };
                const range = new monaco.Range(
                    startPosition.lineNumber,
                    startPosition.column,
                    endPosition.lineNumber,
                    endPosition.column
                );
                
                editor.executeEdits('heading', [{ range, text: prefix }]);
            }
        } else {
            // Add new heading
            const range = new monaco.Range(
                lineNumber,
                1,
                lineNumber,
                1
            );
            
            editor.executeEdits('heading', [{ range, text: prefix }]);
        }
    },
    
    list: (type) => {
        const selection = editor.getSelection();
        const selectedText = editor.getModel().getValueInRange(selection);
        
        let lines = selectedText.split('\n');
        let prefix = type === 'bullet' ? '* ' : '1. ';
        
        // Process each line and add the appropriate prefix
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line) {
                if (type === 'numbered' && i > 0) {
                    prefix = `${i + 1}. `;
                }
                
                // Check if the line already has a list prefix
                if (!line.startsWith('* ') && !line.match(/^\d+\.\s/)) {
                    lines[i] = prefix + line;
                }
            }
        }
        
        const newText = lines.join('\n');
        editor.executeEdits('list', [{
            range: selection,
            text: newText,
            forceMoveMarkers: true
        }]);
    },
    
    codeBlock: (language) => {
        const selection = editor.getSelection();
        const selectedText = editor.getModel().getValueInRange(selection);
        
        // Create code block with language
        const codeBlock = `\`\`\`${language || 'plaintext'}\n${selectedText}\n\`\`\``;
        
        editor.executeEdits('codeBlock', [{
            range: selection,
            text: codeBlock,
            forceMoveMarkers: true
        }]);
    },
    
    highlight: () => {
        const selection = editor.getSelection();
        const selectedText = editor.getModel().getValueInRange(selection);
        
        const highlightedText = `==${selectedText}==`;
        
        editor.executeEdits('highlight', [{
            range: selection,
            text: highlightedText,
            forceMoveMarkers: true
        }]);
    },
    
    commentBlock: () => {
        const selection = editor.getSelection();
        const selectedText = editor.getModel().getValueInRange(selection);
        
        const commentedText = `<!-- ${selectedText} -->`;
        
        editor.executeEdits('commentBlock', [{
            range: selection,
            text: commentedText,
            forceMoveMarkers: true
        }]);
    },
    
    textColor: (color) => {
        const selection = editor.getSelection();
        const selectedText = editor.getModel().getValueInRange(selection);
        
        const coloredText = `<span style="color:${color}">${selectedText}</span>`;
        
        editor.executeEdits('textColor', [{
            range: selection,
            text: coloredText,
            forceMoveMarkers: true
        }]);
    },
    
    addCopyableCodeSnippet: () => {
        createCopyableCodeBlock();
    }
};

// Initialize editor page
document.addEventListener('DOMContentLoaded', async () => {
    // Only initialize editor-specific features if we're on the editor page
    if (window.location.pathname.includes('/editor')) {
        try {
            initializeTheme();
            initializeEditor();
            initializeEventListeners();
            initializeUI();
            
            // Only initialize format toolbar if we're on a page with the editor
            if (document.getElementById('editor')) {
                initializeFormatToolbar();
            }
            
            // Check if the user is authenticated before loading classes
            await checkSession();
            await loadClassList();
            
            console.log("Editor initialization complete");
        } catch (error) {
            console.error("Error during editor initialization:", error);
            showToast("There was an error setting up the editor. Please refresh the page.", "error");
        }
    } else {
        // For other pages, just check session
        checkSession();
    }
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
    
    // Permission toggle in share modal
    document.getElementById('shareEditPermission').addEventListener('change', updateShareUrl);
    
    // Theme toggle
    document.getElementById('theme-toggle').addEventListener('change', (e) => {
        const theme = e.target.checked ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    });
    
    // Color picker for text coloring
    document.getElementById('colorPicker').addEventListener('change', (e) => {
        formatOperations.textColor(e.target.value);
        editor.focus();
    });
}

// Load existing classes
async function loadClassList() {
    try {
        console.log("Loading class list...");
        const response = await fetch('/api/classes', {
            credentials: 'include' // Ensure cookies are sent
        });
        
        if (!response.ok) {
            throw new Error('Failed to load classes');
        }
        
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

        // Clear existing map to avoid duplicates
        classesMap.clear();
        
        classes.forEach(classItem => {
            classesMap.set(classItem.classroom_id, classItem);
            addClassToList(classItem);
        });
        
        console.log(`Loaded ${classes.length} classes successfully`);
    } catch (error) {
        console.error('Failed to load classes:', error);
        showToast('Error loading classes. Please refresh the page.', 'error');
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

        // Store current content before loading
        const currentContent = editor.getValue();
        
        // Show loading state
        editor.setValue('Loading...');

        try {
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
                    
                    // Set format options if present
                    if (content.formatOptions) {
                        const enableMarkdown = document.getElementById('enableMarkdown');
                        const enableHTML = document.getElementById('enableHTML');
                        
                        if (enableMarkdown) enableMarkdown.checked = content.formatOptions.enableMarkdown;
                        if (enableHTML) enableHTML.checked = content.formatOptions.enableHTML;
                    }
                } catch (e) {
                    editor.setValue(data.content);
                }
            } else {
                editor.setValue('');
            }

            // Update last accessed time
            classData.last_accessed = new Date().toISOString();
            
            // Set up polling for updates from viewers
            setupRealtimeUpdates();
        } catch (error) {
            console.error('Failed to load notes:', error);
            showToast('Failed to load notes', 'error');
            
            // Restore previous content if it exists and isn't just "Loading..."
            if (currentContent && currentContent !== 'Loading...') {
                editor.setValue(currentContent);
            } else {
                // If there was no previous content, set to empty string
                editor.setValue('');
            }
        }
    } catch (error) {
        console.error('Error in selectClass:', error);
        showToast('An error occurred while selecting the class', 'error');
    }
}

// Add this new function to poll for updates when a document is shared
let updatePollingInterval = null;

function setupRealtimeUpdates() {
    // Clear any existing interval
    if (updatePollingInterval) {
        clearInterval(updatePollingInterval);
    }
    
    // Set a new interval to check for updates every 2 seconds
    updatePollingInterval = setInterval(checkForUpdates, 2000);
}

// Function to check for updates to the current document
async function checkForUpdates() {
    if (!currentClassId) return;
    
    try {
        // Add a cache-busting parameter to avoid cached responses
        const timestamp = Date.now();
        const response = await fetch(`/api/notes/${currentClassId}?timestamp=${timestamp}`);
        
        if (!response.ok) {
            throw new Error('Failed to check for updates');
        }
        
        const data = await response.json();
        
        if (data.content) {
            try {
                const contentObj = JSON.parse(data.content);
                const currentValue = editor.getValue();
                
                // Only update if:
                // 1. The content has changed
                // 2. The editor doesn't have focus (to avoid disrupting current editing)
                // 3. The content wasn't just saved by this editor instance (to avoid update loops)
                if (contentObj.text !== currentValue && !editor.hasTextFocus() && !recentlySaved) {
                    // Store cursor position
                    const position = editor.getPosition();
                    
                    // Update content
                    editor.setValue(contentObj.text);
                    
                    // Restore cursor position if possible
                    if (position) {
                        editor.setPosition(position);
                    }
                    
                    // Show toast notification
                    showToast('Document updated with changes from another user', 'info');
                    
                    // Update language if it changed
                    if (contentObj.language && contentObj.language !== editor.getModel().getLanguageId()) {
                        document.getElementById('languageSelect').value = contentObj.language;
                        monaco.editor.setModelLanguage(editor.getModel(), contentObj.language);
                    }
                    
                    // Update class data
                    const classData = classesMap.get(currentClassId);
                    if (classData) {
                        classData.last_updated = data.last_updated || new Date().toISOString();
                    }
                }
            } catch (e) {
                console.error('Error parsing updated content', e);
            }
        }
    } catch (error) {
        console.error('Error checking for updates:', error);
    }
}

// Track recent saves to prevent update loops
let recentlySaved = false;
let recentlySavedTimeout = null;

// Enhanced updateNotes function with better collaborative features
async function updateNotes() {
    // Only save if a class is selected and editor exists
    if (!currentClassId || !editor) return;
    
    // Update save status
    updateSaveStatus('saving');

    try {
        // Get the current content and language
        const text = editor.getValue();
        const language = editor.getModel().getLanguageId();
        
        // Get formatting options if they exist
        const formatOptions = {};
        const enableMarkdown = document.getElementById('enableMarkdown');
        const enableHTML = document.getElementById('enableHTML');
        
        if (enableMarkdown) formatOptions.enableMarkdown = enableMarkdown.checked;
        if (enableHTML) formatOptions.enableHTML = enableHTML.checked;
        
        // Create content object
        const content = {
            text: text,
            language: language,
            formatOptions: formatOptions,
            timestamp: Date.now()
        };

        // Send data to server
        const response = await fetch(`/api/notes/${currentClassId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                content: JSON.stringify(content)
            })
        });

        if (!response.ok) {
            throw new Error('Failed to save');
        }

        // Update the class map with new data
        if (classesMap.has(currentClassId)) {
            const classData = classesMap.get(currentClassId);
            classData.last_updated = new Date().toISOString();
        }
        
        // Set flag to prevent update loops
        recentlySaved = true;
        
        // Clear any existing timeout
        if (recentlySavedTimeout) {
            clearTimeout(recentlySavedTimeout);
        }
        
        // Reset flag after a short delay
        recentlySavedTimeout = setTimeout(() => {
            recentlySaved = false;
        }, 1000);

        // Update save status
        updateSaveStatus('saved');
    } catch (error) {
        console.error('Error saving notes:', error);
        updateSaveStatus('error');
        showToast('Failed to save changes', 'error');
    }
}

// Show share modal
function showShareModal() {
    if (!currentClassId) return;
    
    // Get the share modal
    const modal = new bootstrap.Modal(document.getElementById('shareModal'));
    
    // Reset the permission switch to read-only by default
    document.getElementById('shareEditPermission').checked = false;
    
    // Generate the share URL (without permissions initially)
    updateShareUrl();
    
    // Generate QR code for the current URL
    generateQrCode();
    
    modal.show();
}

// Update share URL based on permission toggle
function updateShareUrl() {
    const allowEdit = document.getElementById('shareEditPermission').checked;
    
    // Base URL for viewing
    const baseUrl = `${window.location.origin}/view/${currentClassId}`;
    
    // Create different URLs for view-only vs edit mode
    const shareUrl = allowEdit ? 
        `${baseUrl}?edit=true` : 
        baseUrl;
    
    // Update the modal input field
    document.getElementById('modal-share-url').value = shareUrl;
    
    // Update QR code
    generateQrCode();
}

// Generate QR code for sharing
function generateQrCode() {
    const shareUrl = document.getElementById('modal-share-url').value;
    const qrContainer = document.querySelector('.qr-code-container');
    
    // Clear existing content
    qrContainer.innerHTML = '';
    
    // Generate new QR code
    QRCode.toCanvas(qrContainer, shareUrl, { 
        width: 200,
        margin: 1,
        color: {
            dark: '#000000',
            light: '#ffffff'
        }
    }, function(error) {
        if (error) console.error('Error generating QR code:', error);
    });
}

// Copy modal share URL
function copyModalShareUrl() {
    const modalShareUrl = document.getElementById('modal-share-url');
    modalShareUrl.select();
    document.execCommand('copy');
    
    const button = document.getElementById('modal-copy-btn');
    const originalText = button.innerHTML;
    button.innerHTML = '<i class="bi bi-check"></i> Copied!';
    
    // Show toast notification
    showToast('Share link copied to clipboard', 'success');
    
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

// Update the checkSession function to load classes after session verification
async function checkSession() {
    try {
        const response = await fetch('/api/check-session', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            window.location.href = '/login';
            return;
        }
        
        // If we're on the editor page, make sure classes are loaded
        if (window.location.pathname === '/editor' || window.location.pathname === '/editor/') {
            // Load classes if they haven't been loaded yet
            if (classesMap.size === 0) {
                await loadClassList();
            }
        }
    } catch (error) {
        console.error('Session check failed:', error);
        window.location.href = '/login';
    }
}

// Check session every 5 minutes
setInterval(checkSession, 300000);

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

// Add this new function to initialize the format toolbar with proper null checks
function initializeFormatToolbar() {
    // Add event listeners to format buttons if they exist
    document.querySelectorAll('.format-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const action = e.currentTarget.getAttribute('data-action');
            const param = e.currentTarget.getAttribute('data-param');
            
            if (formatOperations[action]) {
                formatOperations[action](param);
                editor.focus();
            }
        });
    });
    
    // Color picker handling - Add null check
    const colorPicker = document.getElementById('colorPicker');
    if (colorPicker) {
        colorPicker.addEventListener('change', (e) => {
            formatOperations.textColor(e.target.value);
            editor.focus();
        });
    }
    
    // Language for code block - Add null check
    const codeBlockLanguage = document.getElementById('codeBlockLanguage');
    const addCodeBlock = document.getElementById('addCodeBlock');
    if (codeBlockLanguage && addCodeBlock) {
        codeBlockLanguage.addEventListener('change', (e) => {
            const language = e.target.value;
            addCodeBlock.setAttribute('data-param', language);
        });
    }
}

// Add a function to copy code from code snippets
function copyCode(button) {
    const codeBlock = button.closest('.code-snippet').querySelector('code');
    const text = codeBlock.textContent;
    
    navigator.clipboard.writeText(text).then(() => {
        const originalText = button.textContent;
        button.textContent = 'Copied!';
        button.classList.add('copied');
        
        setTimeout(() => {
            button.textContent = originalText;
            button.classList.remove('copied');
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy text: ', err);
        showToast('Failed to copy code', 'error');
    });
}

// Expose the copyCode function globally
window.copyCode = copyCode;

// Add a function to create copyable code blocks
function createCopyableCodeBlock() {
    const selection = editor.getSelection();
    const selectedText = editor.getModel().getValueInRange(selection);
    const language = document.getElementById('languageSelect').value;
    
    // Create HTML for a copyable code block
    const codeBlock = `
<div class="code-snippet">
    <div class="code-header">
        <span class="language-label">${language}</span>
        <button class="copy-btn" onclick="copyCode(this)">Copy</button>
    </div>
    <pre class="language-${language}"><code>${selectedText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
</div>`;
    
    editor.executeEdits('', [{
        range: selection,
        text: codeBlock,
        forceMoveMarkers: true
    }]);
} 