document.getElementById('login-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const remember = document.getElementById('remember').checked;
    
    // Get the submit button and store its original text
    const submitBtn = this.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    
    console.log('Login attempt:', { email, remember });
    console.log('Current cookies:', document.cookie);
    
    try {
        // Show loading state
        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Logging in...';
        submitBtn.disabled = true;

        console.log('Sending login request to server...');
        const response = await fetch('/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, password, remember }),
            credentials: 'include'
        });
        
        console.log('Login response status:', response.status);
        console.log('Login response headers:', Object.fromEntries([...response.headers]));
        
        if (!response.ok) {
            console.error('Login failed with status:', response.status);
            const errorData = await response.json().catch(() => ({}));
            console.error('Error details:', errorData);
            throw new Error('Login failed');
        }
        
        const data = await response.json();
        console.log('Login response data:', data);
        
        if (data.success) {
            // Show success message
            showToast('Login successful! Redirecting...', 'success');
            
            // Store email in session storage if remember is checked
            if (remember) {
                sessionStorage.setItem('userEmail', email);
            }
            
            // Redirect after a short delay
            setTimeout(() => {
                window.location.href = data.redirect;
            }, 1000);
        } else {
            console.error('Login failed with message:', data.error);
            showToast(data.error || 'Login failed', 'error');
        }
    } catch (error) {
        console.error('Login error:', error);
        console.error('Error stack:', error.stack);
        showToast('Login failed. Please try again.', 'error');
    } finally {
        // Restore button state
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
});

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast align-items-center text-white bg-${type} border-0 position-fixed top-0 end-0 m-3`;
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

// Social login handlers
document.querySelectorAll('.social-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        showToast('Social login coming soon!', 'info');
    });
});