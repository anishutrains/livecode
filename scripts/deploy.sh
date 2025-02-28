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

# First, stop services
sudo systemctl stop nginx
sudo systemctl stop livecode

# Create directories if they don't exist
sudo mkdir -p $APP_DIR
sudo mkdir -p $APP_DIR/frontend/static/{css,js,images}
sudo mkdir -p $APP_DIR/logs
sudo mkdir -p /var/log/livecode

# Set initial ownership to ubuntu user
sudo chown -R ubuntu:ubuntu $APP_DIR

# Copy application files
echo "Copying application files..."
sudo cp -r "$PROJECT_DIR/frontend" $APP_DIR/
sudo cp -r "$PROJECT_DIR/backend" $APP_DIR/
sudo cp "$PROJECT_DIR/requirements.txt" $APP_DIR/

# Create .env file
sudo tee $APP_DIR/.env << EOF
FLASK_ENV=production
AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
AWS_DEFAULT_REGION=${AWS_REGION}
EOF

# Set up Python virtual environment as ubuntu user
cd $APP_DIR
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
pip install gunicorn python-dotenv

# After setting up virtual environment but before configuring services,
# add this consolidated permissions section:

echo "Setting up permissions..."

# Fix parent directory permissions
sudo chmod 755 /home/ubuntu
sudo chmod 755 $APP_DIR
sudo chmod 755 $APP_DIR/frontend

# Set base permissions for application files
sudo find $APP_DIR -type d -exec chmod 755 {} \;
sudo find $APP_DIR -type f -exec chmod 644 {} \;

# Set specific permissions
sudo chmod 600 $APP_DIR/.env
sudo chmod -R 755 $APP_DIR/venv

# Set static files ownership and permissions
sudo chown -R www-data:www-data $APP_DIR/frontend/static
sudo find $APP_DIR/frontend/static -type d -exec chmod 755 {} \;
sudo find $APP_DIR/frontend/static -type f -exec chmod 644 {} \;

# Set log directory permissions
sudo chown -R ubuntu:ubuntu /var/log/livecode
sudo chmod -R 755 /var/log/livecode

# Verify permissions
echo "Verifying permissions..."
ls -la $APP_DIR/frontend/static/css/style.css
ls -la $APP_DIR/frontend/static/js/login.js
sudo -u www-data test -r $APP_DIR/frontend/static/css/style.css && echo "Can read style.css" || echo "Cannot read style.css"
sudo -u www-data test -r $APP_DIR/frontend/static/js/login.js && echo "Can read login.js" || echo "Cannot read login.js"

# Configure Nginx
sudo tee /etc/nginx/nginx.conf << 'EOF'
user www-data;
worker_processes auto;
pid /run/nginx.pid;
include /etc/nginx/modules-enabled/*.conf;

events {
    worker_connections 768;
}

http {
    sendfile on;
    tcp_nopush on;
    types_hash_max_size 2048;
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    ssl_protocols TLSv1 TLSv1.1 TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log;
    gzip on;
    include /etc/nginx/conf.d/*.conf;
    include /etc/nginx/sites-enabled/*;
}
EOF

# Configure site
sudo tee /etc/nginx/sites-available/livecode << EOF
server {
    listen 80;
    server_name $DOMAIN;

    access_log /var/log/nginx/livecode_access.log;
    error_log /var/log/nginx/livecode_error.log;

    location /static/ {
        alias $APP_DIR/frontend/static/;
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

# Setup Nginx
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/livecode /etc/nginx/sites-enabled/

# Create systemd service
sudo tee /etc/systemd/system/livecode.service << EOF
[Unit]
Description=LiveCode Application
After=network.target

[Service]
User=ubuntu
Group=ubuntu
WorkingDirectory=$APP_DIR/backend
Environment="PATH=$APP_DIR/venv/bin"
Environment="FLASK_APP=app.py"
Environment="FLASK_ENV=production"
Environment="AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}"
Environment="AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}"
Environment="AWS_DEFAULT_REGION=${AWS_REGION}"

ExecStart=$APP_DIR/venv/bin/gunicorn --workers 3 --bind 127.0.0.1:5000 app:app

Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Verify configurations
echo "Testing Nginx configuration..."
sudo nginx -t

# Start services
sudo systemctl daemon-reload
sudo systemctl enable livecode
sudo systemctl start livecode
sudo systemctl start nginx

# Debug information
echo "Checking service statuses..."
sudo systemctl status nginx --no-pager
sudo systemctl status livecode --no-pager

echo "Deployment completed successfully!"
echo "Your application should now be accessible at https://$DOMAIN"

# Display status
echo "Service status:"
sudo systemctl status livecode --no-pager
echo "Nginx status:"
sudo systemctl status nginx --no-pager

# Install SSL certificate
echo "Installing SSL certificate..."
sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN --redirect