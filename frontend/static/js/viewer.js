let classroomId = window.location.pathname.split('/').pop();
let pollInterval = null;
let quill = null;

document.addEventListener('DOMContentLoaded', () => {
    initializeTheme();
    initializeQuill();
    loadNotes();
    setupEventListeners();
});

function initializeTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    document.getElementById('theme-toggle').checked = savedTheme === 'dark';
}

function initializeQuill() {
    quill = new Quill('#viewer', {
        theme: 'bubble',
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
        
        // Update title
        document.getElementById('class-title').textContent = 
            `Class ${classId.split('-')[1]}`;
        
        // Update content
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
            quill.setText('No notes available');
        }
        
        // Update last modified time
        if (data.last_updated) {
            const lastUpdated = new Date(data.last_updated).toLocaleString();
            document.getElementById('last-updated').textContent = 
                `Last updated: ${lastUpdated}`;
        }

    } catch (error) {
        console.error('Error loading notes:', error);
        document.getElementById('notes-content').innerHTML = `
            <div class="alert alert-danger">
                Failed to load notes. Please try refreshing the page.
            </div>
        `;
    }
}

// Auto-refresh notes every 30 seconds
setInterval(loadNotes, 30000);

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (pollInterval) {
        clearInterval(pollInterval);
    }
}); 