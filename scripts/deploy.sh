#!/bin/bash

# Stop on any error
set -e

echo "Starting deployment..."

# Variables
DOMAIN="livecode.awscertif.site"
APP_DIR="/home/ubuntu/livecode"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

# Debug information
echo "Current directory: $(pwd)"
echo "Script directory: $SCRIPT_DIR"
echo "Project directory: $PROJECT_DIR"
echo "Listing project directory contents:"
ls -la "$PROJECT_DIR"

# Update system
echo "Updating system packages..."
sudo apt-get update
sudo apt-get install -y python3-pip python3-venv nginx certbot python3-certbot-nginx

# Create and setup application directory
cd /home/ubuntu
sudo mkdir -p $APP_DIR

# Copy application files
echo "Copying application files..."
echo "Copying from: $PROJECT_DIR"
echo "Copying to: $APP_DIR"

if [ -d "$PROJECT_DIR/frontend" ]; then
    echo "Frontend directory exists"
    sudo cp -r "$PROJECT_DIR/frontend" $APP_DIR/
else
    echo "ERROR: Frontend directory not found at $PROJECT_DIR/frontend"
    ls -la "$PROJECT_DIR"
    exit 1
fi

if [ -d "$PROJECT_DIR/backend" ]; then
    echo "Backend directory exists"
    sudo cp -r "$PROJECT_DIR/backend" $APP_DIR/
else
    echo "ERROR: Backend directory not found at $PROJECT_DIR/backend"
    ls -la "$PROJECT_DIR"
    exit 1
fi

if [ -f "$PROJECT_DIR/requirements.txt" ]; then
    echo "Requirements.txt exists"
    sudo cp "$PROJECT_DIR/requirements.txt" $APP_DIR/
else
    echo "ERROR: requirements.txt not found at $PROJECT_DIR/requirements.txt"
    ls -la "$PROJECT_DIR"
    exit 1
fi

# Create .env file with secrets
sudo tee $APP_DIR/.env << EOF
FLASK_ENV=production
AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
AWS_DEFAULT_REGION=${AWS_REGION}
EOF

# Ensure proper permissions
sudo chown -R ubuntu:ubuntu $APP_DIR
sudo chmod 600 $APP_DIR/.env

# Create .env file in backend directory
sudo tee $APP_DIR/backend/.env << EOF
FLASK_ENV=production
FLASK_APP=app.py
AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
AWS_DEFAULT_REGION=${AWS_REGION}
EOF

# Set proper permissions
sudo chmod 600 $APP_DIR/backend/.env
sudo chown ubuntu:ubuntu $APP_DIR/backend/.env

# Setup Python virtual environment
cd $APP_DIR
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
pip install gunicorn python-dotenv

# Create systemd service
sudo tee /etc/systemd/system/livecode.service << EOF
[Unit]
Description=LiveCode Application
After=network.target

[Service]
User=ubuntu
WorkingDirectory=$APP_DIR/backend
Environment="PATH=$APP_DIR/venv/bin"
Environment="FLASK_APP=app.py"
Environment="FLASK_ENV=production"
Environment="PYTHONPATH=$APP_DIR"
Environment="AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}"
Environment="AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}"
Environment="AWS_DEFAULT_REGION=${AWS_REGION}"

ExecStart=/bin/bash -c 'mkdir -p /var/log/livecode && \
    $APP_DIR/venv/bin/gunicorn \
    --workers 3 \
    --bind unix:$APP_DIR/backend/livecode.sock \
    --access-logfile /var/log/livecode/access.log \
    --error-logfile /var/log/livecode/error.log \
    --capture-output \
    --log-level debug \
    -m 007 \
    app:app'

Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Configure Nginx
sudo tee /etc/nginx/sites-available/livecode << EOF
server {
    listen 80;
    server_name $DOMAIN;
    
    # Add error and access logs
    access_log /var/log/nginx/livecode_access.log;
    error_log /var/log/nginx/livecode_error.log;
    
    location / {
        include proxy_params;
        proxy_pass http://unix:$APP_DIR/backend/livecode.sock;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /static {
        alias $APP_DIR/frontend/static;
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }
}
EOF

# Create symbolic link
sudo ln -sf /etc/nginx/sites-available/livecode /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Create log directories and files
echo "Setting up log directories and files..."
sudo mkdir -p /var/log/livecode
sudo mkdir -p $APP_DIR/logs

# Create log files
sudo touch /var/log/nginx/livecode_access.log
sudo touch /var/log/nginx/livecode_error.log
sudo touch /var/log/livecode/access.log
sudo touch /var/log/livecode/error.log

# Set proper permissions
sudo chown -R ubuntu:ubuntu /var/log/livecode
sudo chmod -R 755 /var/log/livecode
sudo chown ubuntu:ubuntu /var/log/livecode/*.log
sudo chmod 644 /var/log/livecode/*.log

sudo chown -R ubuntu:ubuntu $APP_DIR/logs
sudo chmod -R 755 $APP_DIR/logs

sudo chown www-data:adm /var/log/nginx/livecode_*.log
sudo chmod 640 /var/log/nginx/livecode_*.log

# Start and enable services
echo "Starting services..."
sudo systemctl daemon-reload
sudo systemctl enable livecode
sudo systemctl restart livecode
sudo systemctl restart nginx

# After starting services, add these debugging commands:
echo "Checking service status and logs..."
sudo systemctl status livecode
echo "Checking Nginx error log..."
sudo tail -n 50 /var/log/nginx/livecode_error.log
echo "Checking application error log..."
sudo tail -n 50 /var/log/livecode/error.log
echo "Checking socket file..."
ls -l $APP_DIR/backend/livecode.sock
echo "Checking permissions..."
ls -l $APP_DIR/backend
ls -l $APP_DIR/frontend/static

# Check if socket exists and has correct permissions
if [ ! -S "$APP_DIR/backend/livecode.sock" ]; then
    echo "Socket file not found!"
    exit 1
fi

# Verify Nginx configuration
sudo nginx -t

# Install SSL certificate using Certbot
echo "Installing SSL certificate..."
sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN --redirect

# Final Nginx restart
sudo systemctl restart nginx

echo "Deployment completed successfully!"
echo "Your application should now be accessible at https://$DOMAIN"

# Display status
echo "Service status:"
sudo systemctl status livecode --no-pager
echo "Nginx status:"
sudo systemctl status nginx --no-pager 