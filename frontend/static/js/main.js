let classroomId = null;
let isTeacher = false;

// Initialize AWS SDK
AWS.config.region = 'your-region';
AWS.config.credentials = new AWS.CognitoIdentityCredentials({
    IdentityPoolId: 'your-identity-pool-id',
});

const editor = document.getElementById('note-editor');
const loginForm = document.getElementById('login-form');
const editorSection = document.getElementById('editor-section');
const loginSection = document.getElementById('login-section');

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, password })
        });
        
        if (response.ok) {
            isTeacher = true;
            // Generate a simple classroom ID for testing
            classroomId = 'classroom-' + Date.now();
            loginSection.classList.add('d-none');
            editorSection.classList.remove('d-none');
            initializeEditor();
            
            // Update share button
            const shareBtn = document.getElementById('share-btn');
            shareBtn.addEventListener('click', () => {
                const shareUrl = `${window.location.origin}/?share=${classroomId}`;
                alert(`Share this URL with students:\n${shareUrl}`);
            });
        }
    } catch (error) {
        console.error('Login failed:', error);
        alert('Login failed. Please try again.');
    }
});

function initializeEditor() {
    let timeout = null;
    
    editor.addEventListener('input', () => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(updateNotes, 1000);
    });
}

async function updateNotes() {
    if (!isTeacher) return;
    
    try {
        await fetch(`/api/notes/${classroomId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                content: editor.value
            })
        });
    } catch (error) {
        console.error('Failed to update notes:', error);
    }
}

// Function to initialize student view
function initializeStudentView(shareId) {
    classroomId = shareId;
    editor.readOnly = true;
    editor.classList.add('readonly');
    
    // Poll for updates every 2 seconds
    setInterval(async () => {
        try {
            const response = await fetch(`/api/notes/${classroomId}`);
            const data = await response.json();
            editor.value = data.content || '';
        } catch (error) {
            console.error('Failed to fetch notes:', error);
        }
    }, 2000);
}

// Check URL parameters for share link
const urlParams = new URLSearchParams(window.location.search);
const shareId = urlParams.get('share');
if (shareId) {
    loginSection.classList.add('d-none');
    editorSection.classList.remove('d-none');
    initializeStudentView(shareId);
} 