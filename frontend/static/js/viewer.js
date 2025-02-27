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
            wordWrap: 'on',
            padding: { top: 20, bottom: 20 }
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

    // Add PDF download handler
    document.getElementById('download-pdf').addEventListener('click', generatePDF);
}

function initializeTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    document.getElementById('theme-toggle').checked = savedTheme === 'dark';
}

async function generatePDF() {
    try {
        const content = editor.getValue();
        const classTitle = document.getElementById('class-title').textContent;
        
        // Create a temporary div for PDF generation
        const tempDiv = document.createElement('div');
        tempDiv.style.padding = '20px';
        
        // Add header
        tempDiv.innerHTML = `
            <h1 style="margin-bottom: 20px;">${classTitle}</h1>
            <div style="white-space: pre-wrap; font-family: monospace;">${content}</div>
        `;
        
        // PDF options
        const opt = {
            margin: 1,
            filename: `${classTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_notes.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2 },
            jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
        };

        // Generate PDF
        const element = tempDiv;
        html2pdf().set(opt).from(element).save();
    } catch (error) {
        console.error('Failed to generate PDF:', error);
        alert('Failed to generate PDF. Please try again.');
    }
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (pollInterval) {
        clearInterval(pollInterval);
    }
}); 