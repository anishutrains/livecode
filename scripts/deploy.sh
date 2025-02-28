#!/bin/bash

# Stop on any error
set -e

echo "Starting deployment to production..."

# Variables
DOMAIN="livecode.awscertif.site"
APP_DIR="/home/ubuntu/livecode"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

# Debug information
echo "Current directory: $(pwd)"
echo "Script directory: $SCRIPT_DIR"
echo "Project directory: $PROJECT_DIR"

# Update system
echo "Updating system packages..."
sudo apt-get update
sudo apt-get install -y python3-pip python3-venv nginx certbot python3-certbot-nginx

# Create and setup application directory
cd /home/ubuntu
sudo mkdir -p $APP_DIR

# Copy application files
echo "Copying application files..."
sudo cp -r "$PROJECT_DIR/frontend" $APP_DIR/
sudo cp -r "$PROJECT_DIR/backend" $APP_DIR/
sudo cp "$PROJECT_DIR/requirements.txt" $APP_DIR/

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
sudo chmod -R 755 $APP_DIR
sudo chmod -R 755 $APP_DIR/frontend/static

# Ensure static directory exists
sudo mkdir -p $APP_DIR/frontend/static
sudo chown -R ubuntu:ubuntu $APP_DIR/frontend/static
sudo chmod -R 755 $APP_DIR/frontend/static

# After copying files, verify static files
echo "Verifying static files..."
ls -la $APP_DIR/frontend/static/css/
ls -la $APP_DIR/frontend/static/js/

# Ensure static directories exist and have correct permissions
sudo mkdir -p $APP_DIR/frontend/static/css
sudo mkdir -p $APP_DIR/frontend/static/js
sudo mkdir -p $APP_DIR/frontend/static/images

# Copy static files with explicit paths
echo "Copying static files..."
sudo cp -r "$PROJECT_DIR/frontend/static/css/"* "$APP_DIR/frontend/static/css/"
sudo cp -r "$PROJECT_DIR/frontend/static/js/"* "$APP_DIR/frontend/static/js/"
sudo cp -r "$PROJECT_DIR/frontend/static/images/"* "$APP_DIR/frontend/static/images/"

# Set permissions
sudo chown -R ubuntu:ubuntu $APP_DIR/frontend/static
sudo chmod -R 755 $APP_DIR/frontend/static

# Verify Nginx configuration
echo "Testing Nginx configuration..."
sudo nginx -t

# Add debug output for static files
echo "Static files in production:"
ls -R $APP_DIR/frontend/static/

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
Environment="PATH=$APP_DIR/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
Environment="FLASK_APP=app.py"
Environment="FLASK_ENV=production"
Environment="AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}"
Environment="AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}"
Environment="AWS_DEFAULT_REGION=${AWS_REGION}"

ExecStart=$APP_DIR/venv/bin/gunicorn --workers 3 --bind 127.0.0.1:5000 app:app

[Install]
WantedBy=multi-user.target
EOF

# Configure Nginx
sudo tee /etc/nginx/sites-available/livecode << EOF
server {
    listen 80;
    server_name $DOMAIN;

    access_log /var/log/nginx/livecode_access.log;
    error_log /var/log/nginx/livecode_error.log;

    # Handle static files directly through Nginx
    location /static {
        alias $APP_DIR/frontend/static;
        try_files \$uri \$uri/ =404;
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 300s;
        proxy_read_timeout 300s;
    }
}
EOF

# Create symbolic link
sudo ln -sf /etc/nginx/sites-available/livecode /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Create log directories with proper permissions
sudo mkdir -p /var/log/livecode
sudo chown -R ubuntu:ubuntu /var/log/livecode
sudo chmod -R 755 /var/log/livecode

# Create local logs directory
mkdir -p $APP_DIR/logs
sudo chown -R ubuntu:ubuntu $APP_DIR/logs
sudo chmod -R 755 $APP_DIR/logs

# Start and enable services
echo "Starting services..."
sudo systemctl daemon-reload
sudo systemctl enable livecode
sudo systemctl restart livecode
sudo systemctl restart nginx

# Check if application is running
echo "Checking application status..."
sleep 5
if curl -s http://localhost:5000/health > /dev/null; then
    echo "Application is running!"
    sudo systemctl status livecode --no-pager
else
    echo "Application failed to start. Checking logs:"
    sudo journalctl -u livecode --no-pager -n 50
    exit 1
fi

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