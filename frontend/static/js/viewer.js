let classroomId = window.location.pathname.split('/').pop();
let pollInterval = null;
let quill = null;
let lastContent = null; // Track last content to avoid unnecessary updates

document.addEventListener('DOMContentLoaded', () => {
    initializeTheme();
    initializeQuill();
    loadNotes();
    setupEventListeners();
    
    // Set polling interval to 2 seconds
    pollInterval = setInterval(loadNotes, 2000);
});

function initializeTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    document.getElementById('theme-toggle').checked = savedTheme === 'dark';
}

function initializeQuill() {
    quill = new Quill('#viewer', {
        theme: 'bubble',
        modules: {
            syntax: {
                highlight: text => hljs.highlightAuto(text).value
            }
        },
        readOnly: true
    });
}

function setupEventListeners() {
    // Theme toggle
    document.getElementById('theme-toggle').addEventListener('change', (e) => {
        const theme = e.target.checked ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    });

    // Print button
    document.getElementById('print-btn').addEventListener('click', () => {
        window.print();
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
                    if (content.delta) {
                        quill.setContents(content.delta);
                    } else {
                        quill.setText(content.text || '');
                    }
                } catch (e) {
                    quill.setText(data.content);
                }
            } else {
                quill.setText('No notes available');
            }
            
            if (data.last_updated) {
                const lastUpdated = new Date(data.last_updated).toLocaleString();
                document.getElementById('last-updated').textContent = 
                    `Last updated: ${lastUpdated}`;
            }
        }
    } catch (error) {
        console.error('Failed to load notes:', error);
        document.getElementById('viewer').innerHTML = `
            <div class="alert alert-danger">
                Failed to load notes. Please try refreshing the page.
            </div>
        `;
    }
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (pollInterval) {
        clearInterval(pollInterval);
    }
}); 