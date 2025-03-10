let editor = null;
let pollInterval = null;
let lastContent = null;

document.addEventListener('DOMContentLoaded', function() {
    initializeTheme();
    initializeEditor();
    setupEventListeners();
    startPolling();
});

function initializeEditor() {
    require(['vs/editor/editor.main'], function() {
        // Define custom themes
        monaco.editor.defineTheme('custom-dark', {
            base: 'vs-dark',
            inherit: true,
            rules: [
                { token: 'comment', foreground: '6A9955' },
                { token: 'keyword', foreground: '569CD6' },
                { token: 'string', foreground: 'CE9178' },
                { token: 'number', foreground: 'B5CEA8' },
                { token: 'function', foreground: 'DCDCAA' }
            ],
            colors: {
                'editor.background': '#1E1E1E',
                'editor.foreground': '#D4D4D4',
                'editor.lineHighlightBackground': '#2D2D2D',
                'editor.selectionBackground': '#264F78',
                'editorCursor.foreground': '#FFFFFF',
                'editorLineNumber.foreground': '#858585'
            }
        });

        editor = monaco.editor.create(document.getElementById('viewer'), {
            value: 'Loading...',
            language: 'plaintext',
            theme: localStorage.getItem('theme') === 'dark' ? 'custom-dark' : 'vs',
            readOnly: true,
            automaticLayout: true,
            minimap: { enabled: true },
            fontSize: 14,
            lineNumbers: 'on',
            renderIndentGuides: true,
            tabSize: 4,
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            padding: { top: 20, bottom: 20 },
            folding: true,
            bracketPairColorization: { enabled: true }
        });

        loadNotes();
    });
}

async function loadNotes() {
    try {
        const classId = document.getElementById('viewer').dataset.classroomId;
        const response = await fetch(`/api/notes/${classId}?view=true`);
        
        if (!response.ok) {
            throw new Error('Failed to fetch notes');
        }

        const data = await response.json();
        
        if (JSON.stringify(data.content) !== lastContent) {
            lastContent = JSON.stringify(data.content);
            
            document.getElementById('class-name').textContent = 
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

            // Remove loading overlay
            const loadingOverlay = document.querySelector('.loading-overlay');
            if (loadingOverlay) {
                loadingOverlay.remove();
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
        editor.updateOptions({ 
            theme: theme === 'dark' ? 'custom-dark' : 'vs'
        });
    });

    // Fullscreen button
    document.getElementById('fullscreen-btn').addEventListener('click', () => {
        const viewerElement = document.getElementById('viewer');
        if (!document.fullscreenElement) {
            viewerElement.requestFullscreen();
            document.getElementById('fullscreen-btn').innerHTML = `
                <i class="bi bi-fullscreen-exit"></i>
                <span>Exit Fullscreen</span>
            `;
        } else {
            document.exitFullscreen();
            document.getElementById('fullscreen-btn').innerHTML = `
                <i class="bi bi-arrows-fullscreen"></i>
                <span>Fullscreen</span>
            `;
        }
    });

    // Print button
    document.getElementById('print-btn').addEventListener('click', () => {
        window.print();
    });

    // Add PDF download handler
    document.getElementById('download-pdf').addEventListener('click', generatePDF);

    // Handle fullscreen change
    document.addEventListener('fullscreenchange', () => {
        const btn = document.getElementById('fullscreen-btn');
        btn.innerHTML = document.fullscreenElement ? 
            `<i class="bi bi-fullscreen-exit"></i><span>Exit Fullscreen</span>` : 
            `<i class="bi bi-arrows-fullscreen"></i><span>Fullscreen</span>`;
    });
}

function initializeTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    document.getElementById('theme-toggle').checked = savedTheme === 'dark';
}

function startPolling() {
    // Poll for updates every 5 seconds
    pollInterval = setInterval(loadNotes, 5000);
}

async function generatePDF() {
    try {
        const content = editor.getValue();
        const classTitle = document.getElementById('class-name').textContent;
        const lastUpdated = document.getElementById('last-updated').textContent;
        
        // Create a styled container for PDF content
        const container = document.createElement('div');
        container.style.padding = '20px';
        container.style.fontFamily = 'Monaco, Consolas, "Courier New", monospace';
        container.style.maxWidth = '800px';
        container.style.margin = '0 auto';
        
        // Add content with styling
        container.innerHTML = `
            <div style="text-align: center; margin-bottom: 30px;">
                <h1 style="color: #333; margin-bottom: 10px;">${classTitle}</h1>
                <p style="color: #666; font-size: 14px;">${lastUpdated}</p>
            </div>
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px;">
                <pre style="white-space: pre-wrap; font-family: Monaco, Consolas, 'Courier New', monospace; 
                           font-size: 14px; line-height: 1.5; margin: 0;">${content}</pre>
            </div>
        `;

        // Show loading indicator
        const loadingToast = showToast('Generating PDF...', 'info', false);
        
        // PDF generation options
        const opt = {
            margin: [0.5, 0.5],
            filename: `${classTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_notes.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { 
                scale: 2,
                useCORS: true,
                logging: false
            },
            jsPDF: { 
                unit: 'in', 
                format: 'a4', 
                orientation: 'portrait'
            }
        };

        // Generate PDF
        await html2pdf().set(opt).from(container).save();
        
        // Hide loading indicator and show success message
        loadingToast.hide();
        showToast('PDF downloaded successfully!', 'success');
        
    } catch (error) {
        console.error('Failed to generate PDF:', error);
        showToast('Failed to generate PDF. Please try again.', 'error');
    }
}

// Add a toast notification function
function showToast(message, type = 'info', autoHide = true) {
    const toastContainer = document.getElementById('toast-container') || (() => {
        const container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 1050;
        `;
        document.body.appendChild(container);
        return container;
    })();

    const toast = document.createElement('div');
    toast.className = `toast align-items-center text-white bg-${type} border-0`;
    toast.style.minWidth = '250px';
    
    toast.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">
                ${message}
            </div>
            ${autoHide ? `
                <button type="button" class="btn-close btn-close-white me-2 m-auto" 
                        data-bs-dismiss="toast"></button>
            ` : ''}
        </div>
    `;
    
    toastContainer.appendChild(toast);
    const bsToast = new bootstrap.Toast(toast, {
        autohide: autoHide,
        delay: 3000
    });
    bsToast.show();

    toast.addEventListener('hidden.bs.toast', () => {
        toast.remove();
    });

    return bsToast;
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (pollInterval) {
        clearInterval(pollInterval);
    }
}); 