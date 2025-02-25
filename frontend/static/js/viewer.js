let editor = null;
let pollInterval = null;
let lastContent = null;

document.addEventListener('DOMContentLoaded', () => {
    initializeTheme();
    initializeEditor();
    setupEventListeners();
    loadNotes();
    
    // Set polling interval to 2 seconds
    pollInterval = setInterval(loadNotes, 2000);
});

function initializeEditor() {
    require(['vs/editor/editor.main'], function() {
        editor = monaco.editor.create(document.getElementById('viewer'), {
            value: 'Loading...',
            language: 'plaintext',
            theme: 'vs-dark',
            readOnly: true,
            automaticLayout: true,
            minimap: { enabled: true },
            fontSize: 14,
            lineNumbers: 'on',
            renderIndentGuides: true,
            tabSize: 4,
            scrollBeyondLastLine: false,
            wordWrap: 'on'
        });
    });
}

async function loadNotes() {
    try {
        const classId = window.location.pathname.split('/').pop();
        const response = await fetch(`/api/notes/${classId}`);
        
        if (!response.ok) {
            throw new Error('Failed to fetch notes');
        }

        const data = await response.json();
        
        if (JSON.stringify(data.content) !== lastContent) {
            lastContent = JSON.stringify(data.content);
            
            document.getElementById('class-title').textContent = 
                data.class_name || `Class ${classId.split('-')[1]}`;
            
            if (data.content) {
                try {
                    const content = JSON.parse(data.content);
                    editor.setValue(content.text || '');
                    
                    // Set language if present
                    if (content.language) {
                        monaco.editor.setModelLanguage(editor.getModel(), content.language);
                    }
                } catch (e) {
                    editor.setValue(data.content);
                }
            } else {
                editor.setValue('No notes available');
            }
            
            if (data.last_updated) {
                const lastUpdated = new Date(data.last_updated).toLocaleString();
                document.getElementById('last-updated').textContent = 
                    `Last updated: ${lastUpdated}`;
            }
        }
    } catch (error) {
        console.error('Failed to load notes:', error);
        editor.setValue('Failed to load notes. Please try refreshing the page.');
    }
}

function setupEventListeners() {
    // Theme toggle
    document.getElementById('theme-toggle').addEventListener('change', (e) => {
        const theme = e.target.checked ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        editor.updateOptions({ theme: e.target.checked ? 'vs-dark' : 'vs' });
    });

    // Print button
    document.getElementById('print-btn').addEventListener('click', () => {
        window.print();
    });
}

function initializeTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    document.getElementById('theme-toggle').checked = savedTheme === 'dark';
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (pollInterval) {
        clearInterval(pollInterval);
    }
}); 