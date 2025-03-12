let editor = null;
let pollInterval = null;
let lastContent = null;
let isEditMode = false;
let recentlySaved = false;
let recentlySavedTimeout = null;

document.addEventListener('DOMContentLoaded', function() {
    // Check URL parameters for edit mode
    const urlParams = new URLSearchParams(window.location.search);
    isEditMode = urlParams.get('edit') === 'true';
    
    // Show edit indicator if in edit mode
    if (isEditMode) {
        const editIndicator = document.getElementById('edit-indicator');
        if (editIndicator) {
            editIndicator.style.display = 'inline-block';
        }
    }
    
    initializeTheme();
    initializeEditor();
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
            readOnly: !isEditMode, // Set readOnly based on edit mode
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
        setupEventListeners();
        
        // Setup real-time updates
        startPolling(); // Always poll for updates, regardless of mode
        
        // If in edit mode, also setup autosave
        if (isEditMode) {
            setupAutoSave();
        }
    });
}

async function loadNotes() {
    try {
        const classId = document.getElementById('viewer').dataset.classroomId;
        
        // Add appropriate parameters based on mode
        let url = `/api/notes/${classId}?view=true`;
        if (isEditMode) {
            url += '&edit=true';
        }
        
        // Add a cache-busting parameter to ensure fresh content
        url += `&timestamp=${Date.now()}`;
        
        const response = await fetch(url);
        
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
                    
                    // Only update if content has changed and we're not currently editing
                    // Also don't update if we just saved content ourselves (to avoid loops)
                    if ((!editor.hasTextFocus() || !isEditMode) && !recentlySaved) {
                        const currentPosition = editor.getPosition();
                        
                        editor.setValue(content.text || '');
                        
                        // Restore cursor position if possible
                        if (currentPosition && isEditMode) {
                            editor.setPosition(currentPosition);
                        }
                        
                        // Set language if present
                        if (content.language) {
                            monaco.editor.setModelLanguage(editor.getModel(), content.language);
                        }
                        
                        // If in edit mode, show a toast notification about the update
                        if (isEditMode) {
                            showToast('Document updated from editor', 'info');
                        }
                    }
                } catch (e) {
                    // Fall back to raw content if parsing fails
                    if (!editor.hasTextFocus() || !isEditMode) {
                        editor.setValue(data.content);
                    }
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
                loadingOverlay.style.display = 'none';
            }
        }
    } catch (error) {
        console.error('Failed to load notes:', error);
        editor.setValue('Failed to load notes. Please try refreshing the page.');
    }
}

function setupEventListeners() {
    // Theme toggle
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('change', (e) => {
            const theme = e.target.checked ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem('theme', theme);
            editor.updateOptions({ 
                theme: theme === 'dark' ? 'custom-dark' : 'vs'
            });
        });
    }

    // Fullscreen button
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', () => {
            const viewerElement = document.getElementById('viewer');
            if (!document.fullscreenElement) {
                viewerElement.requestFullscreen();
                fullscreenBtn.innerHTML = `
                    <i class="bi bi-fullscreen-exit"></i>
                    <span>Exit Fullscreen</span>
                `;
            } else {
                document.exitFullscreen();
                fullscreenBtn.innerHTML = `
                    <i class="bi bi-arrows-fullscreen"></i>
                    <span>Fullscreen</span>
                `;
            }
        });
    }

    // Print button
    const printBtn = document.getElementById('print-btn');
    if (printBtn) {
        printBtn.addEventListener('click', () => {
            window.print();
        });
    }

    // Add PDF download handler
    const downloadPdfBtn = document.getElementById('download-pdf');
    if (downloadPdfBtn) {
        downloadPdfBtn.addEventListener('click', generatePDF);
    }

    // Handle fullscreen change
    document.addEventListener('fullscreenchange', () => {
        const btn = document.getElementById('fullscreen-btn');
        if (btn) {
            btn.innerHTML = document.fullscreenElement ? 
                `<i class="bi bi-fullscreen-exit"></i><span>Exit Fullscreen</span>` : 
                `<i class="bi bi-arrows-fullscreen"></i><span>Fullscreen</span>`;
        }
    });
}

async function setupAutoSave() {
    // Only set up autosave in edit mode
    if (!isEditMode || !editor) return;
    
    let saveTimeout = null;
    
    // Add change event listener to editor
    editor.onDidChangeModelContent(() => {
        // Update status visually if we have the element
        const statusElement = document.getElementById('edit-status');
        if (statusElement) {
            statusElement.textContent = 'Unsaved changes';
            statusElement.classList.add('unsaved');
        }
        
        // Clear any existing timeout
        if (saveTimeout) clearTimeout(saveTimeout);
        
        // Set a new timeout to save after 500ms of inactivity (faster saves)
        saveTimeout = setTimeout(() => {
            saveNotes();
        }, 500); // Quick saves for better real-time collaboration
    });
}

async function saveNotes() {
    // Only proceed if in edit mode
    if (!isEditMode) return;
    
    try {
        const classId = document.getElementById('viewer').dataset.classroomId;
        
        // Update status visually if we have the element
        const statusElement = document.getElementById('edit-status');
        if (statusElement) {
            statusElement.textContent = 'Saving...';
            statusElement.classList.remove('unsaved');
            statusElement.classList.add('saving');
        }
        
        // Prepare content object
        const content = {
            text: editor.getValue(),
            language: editor.getModel().getLanguageId(),
            timestamp: Date.now()
        };
        
        // Set flag to avoid update loop
        recentlySaved = true;
        
        // Clear any existing timeout
        if (recentlySavedTimeout) {
            clearTimeout(recentlySavedTimeout);
        }
        
        // Save to API with edit permission
        const response = await fetch(`/api/notes/${classId}?view=true&edit=true`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                content: JSON.stringify(content)
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to save changes');
        }
        
        // Update last saved timestamp
        document.getElementById('last-updated').textContent = 
            `Last updated: ${new Date().toLocaleString()}`;
        
        // Update status visually if we have the element
        if (statusElement) {
            statusElement.textContent = 'All changes saved';
            statusElement.classList.remove('saving');
            statusElement.classList.add('saved');
            
            // Reset status after a delay
            setTimeout(() => {
                statusElement.classList.remove('saved');
                statusElement.textContent = '';
            }, 3000);
        }
        
        // Reset the recently saved flag after 1 second
        recentlySavedTimeout = setTimeout(() => {
            recentlySaved = false;
        }, 1000);
    } catch (error) {
        console.error('Error saving notes:', error);
        showToast('Failed to save changes', 'error');
        
        // Update status visually on error
        const statusElement = document.getElementById('edit-status');
        if (statusElement) {
            statusElement.textContent = 'Save failed';
            statusElement.classList.remove('saving');
            statusElement.classList.add('error');
        }
        
        // Reset the recently saved flag
        recentlySaved = false;
    }
}

function initializeTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.checked = savedTheme === 'dark';
    }
}

function startPolling() {
    // Clear any existing polling interval first
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
    
    // Set polling interval based on mode
    // For edit mode, check more frequently
    const interval = isEditMode ? 1000 : 2000; // 1 second in edit mode, 2 seconds in view mode
    
    // Start polling at the specified interval
    pollInterval = setInterval(loadNotes, interval);
    
    console.log(`Started polling at ${interval}ms intervals (${isEditMode ? 'edit' : 'view'} mode)`);
}

async function generatePDF() {
    try {
        // Check if html2pdf is available
        if (typeof html2pdf === 'undefined') {
            throw new Error('PDF generation library not loaded');
        }
        
        showToast('Generating PDF...', 'info');
        
        // Get content from editor
        const content = editor.getValue();
        const classTitle = document.getElementById('class-name').textContent;
        const lastUpdated = document.getElementById('last-updated').textContent;
        
        // Create a styled container for the PDF content
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
        
        // Temporarily add to document
        document.body.appendChild(container);

        // Generate PDF - using window.html2pdf to avoid AMD conflicts
        const opt = {
            margin: [0.5, 0.5],
            filename: `${classTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_notes.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2 },
            jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
        };

        // Generate PDF
        window.html2pdf().from(container).set(opt).save().then(() => {
            // Remove container after PDF generation
            document.body.removeChild(container);
            showToast('PDF downloaded successfully!', 'success');
        }).catch(err => {
            console.error('Error generating PDF:', err);
            showToast('Error generating PDF. Please try again.', 'error');
            document.body.removeChild(container);
        });
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