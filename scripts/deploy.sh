#!/bin/bash

# Stop on any error
set -e

echo "Starting deployment..."

# Variables
DOMAIN="livecode.awscertif.site"
APP_DIR="/home/ubuntu/livecode"

# Update system
echo "Updating system packages..."
sudo apt-get update
sudo apt-get install -y python3-pip python3-venv nginx certbot python3-certbot-nginx

# Create and setup application directory
cd /home/ubuntu
sudo mkdir -p $APP_DIR

# Copy application files
echo "Copying application files..."
sudo cp -r frontend $APP_DIR/
sudo cp -r backend $APP_DIR/
sudo cp requirements.txt $APP_DIR/

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
ExecStart=$APP_DIR/venv/bin/gunicorn --workers 3 --bind unix:$APP_DIR/backend/livecode.sock -m 007 app:app

[Install]
WantedBy=multi-user.target
EOF

# Configure Nginx
sudo tee /etc/nginx/sites-available/livecode << EOF
server {
    listen 80;
    server_name $DOMAIN;
    
    location / {
        include proxy_params;
        proxy_pass http://unix:$APP_DIR/backend/livecode.sock;
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
if ! systemctl is-active --quiet livecode; then
    echo "Service failed to start. Checking logs:"
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