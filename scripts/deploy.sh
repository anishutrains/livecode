#!/bin/bash

# Stop on any error
set -e

# Variables
DOMAIN="livecode.awscertif.site"
APP_DIR="/var/www/livecode"
VENV_DIR="$APP_DIR/venv"

# Update system
echo "Updating system packages..."
sudo apt-get update
sudo apt-get upgrade -y

# Install required packages if not already installed
echo "Installing required packages..."
sudo apt-get install -y python3-pip python3-venv nginx certbot python3-certbot-nginx

# Create application directory if it doesn't exist
sudo mkdir -p $APP_DIR

# Copy application files
echo "Copying application files..."
sudo cp -r frontend $APP_DIR/
sudo cp -r backend $APP_DIR/
sudo cp requirements.txt $APP_DIR/

# Create .env file with AWS credentials
sudo tee $APP_DIR/backend/.env << EOF
FLASK_ENV=production
AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
AWS_DEFAULT_REGION=${AWS_REGION}
EOF

# Set proper permissions for .env
sudo chmod 600 $APP_DIR/backend/.env
sudo chown www-data:www-data $APP_DIR/backend/.env

# Set up Python virtual environment
echo "Setting up Python virtual environment..."
sudo python3 -m venv $VENV_DIR
sudo $VENV_DIR/bin/pip install --upgrade pip
sudo $VENV_DIR/bin/pip install -r $APP_DIR/requirements.txt
sudo $VENV_DIR/bin/pip install gunicorn python-dotenv

# Create systemd service file
echo "Creating systemd service..."
sudo tee /etc/systemd/system/livecode.service << EOF
[Unit]
Description=LiveCode Application
After=network.target

[Service]
User=www-data
Group=www-data
WorkingDirectory=$APP_DIR/backend
Environment="PATH=$VENV_DIR/bin"
Environment="PYTHONPATH=$APP_DIR"
Environment="FLASK_APP=app.py"
Environment="FLASK_ENV=production"
ExecStart=$VENV_DIR/bin/gunicorn --workers 3 --bind unix:$APP_DIR/backend/livecode.sock -m 007 app:app

[Install]
WantedBy=multi-user.target
EOF

# Configure Nginx
echo "Configuring Nginx..."
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

# Set permissions
echo "Setting permissions..."
sudo chown -R www-data:www-data $APP_DIR
sudo chmod -R 755 $APP_DIR

# Create log directory
sudo mkdir -p /var/log/livecode
sudo chown www-data:www-data /var/log/livecode

# Start and enable services
echo "Starting services..."
sudo systemctl daemon-reload
sudo systemctl start livecode
sudo systemctl enable livecode
sudo systemctl restart nginx

# Check the application logs if service fails
if ! systemctl is-active --quiet livecode; then
    echo "Service failed to start. Checking logs..."
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