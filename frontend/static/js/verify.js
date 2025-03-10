document.addEventListener('DOMContentLoaded', function() {
    const otpInputs = document.querySelectorAll('.otp-input');
    
    // Auto-focus next input
    otpInputs.forEach((input, index) => {
        input.addEventListener('input', function() {
            if (this.value && index < otpInputs.length - 1) {
                otpInputs[index + 1].focus();
            }
        });

        // Handle backspace
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Backspace' && !this.value && index > 0) {
                otpInputs[index - 1].focus();
            }
        });
    });

    // Handle form submission
    document.getElementById('verify-form').addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const otp = Array.from(otpInputs).map(input => input.value).join('');
        const email = sessionStorage.getItem('verifyEmail');
        
        if (!email) {
            showToast('Please sign up first', 'error');
            return;
        }

        try {
            const response = await fetch('/api/verify', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email, otp })
            });
            
            const data = await response.json();
            
            if (data.success) {
                showToast('Email verified successfully!', 'success');
                sessionStorage.removeItem('verifyEmail');
                setTimeout(() => {
                    window.location.href = '/login';
                }, 1500);
            } else {
                showToast(data.error || 'Verification failed', 'error');
            }
        } catch (error) {
            console.error('Verification error:', error);
            showToast('Verification failed. Please try again.', 'error');
        }
    });

    // Handle resend code
    document.getElementById('resend-btn').addEventListener('click', async function() {
        const email = sessionStorage.getItem('verifyEmail');
        
        if (!email) {
            showToast('Please sign up first', 'error');
            return;
        }

        try {
            const response = await fetch('/api/resend-otp', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email })
            });
            
            const data = await response.json();
            
            if (data.success) {
                showToast('Verification code resent!', 'success');
            } else {
                showToast(data.error || 'Failed to resend code', 'error');
            }
        } catch (error) {
            console.error('Resend error:', error);
            showToast('Failed to resend code. Please try again.', 'error');
        }
    });
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