#!/bin/bash

# Enable error logging
set -e

echo "Starting deployment..."

# Install required packages
sudo apt-get update
sudo apt-get install -y python3-pip python3-venv nginx

# Create and setup application directory
cd /home/ubuntu/classroom-notes

# Create .env file with secrets
sudo tee .env << EOF
FLASK_ENV=production
AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
AWS_DEFAULT_REGION=${AWS_REGION}
EOF

# Ensure proper permissions
sudo chown ubuntu:ubuntu .env
chmod 600 .env

# Setup Python virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install --upgrade pip
pip install -r requirements.txt

# Create simple systemd service
sudo tee /etc/systemd/system/classroom-notes.service << EOF
[Unit]
Description=Classroom Notes Flask App
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/classroom-notes
Environment="FLASK_APP=backend/app.py"
Environment="FLASK_ENV=production"
Environment="AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}"
Environment="AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}"
Environment="AWS_REGION=${AWS_REGION}"

ExecStart=/home/ubuntu/classroom-notes/venv/bin/gunicorn \
    --workers 3 \
    --bind 0.0.0.0:5000 \
    --access-logfile - \
    --error-logfile - \
    backend.app:app

Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Configure Nginx
sudo tee /etc/nginx/sites-available/classroom-notes << EOF
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_redirect off;
    }
}
EOF

# Enable site
sudo ln -sf /etc/nginx/sites-available/classroom-notes /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Restart services
sudo systemctl daemon-reload
sudo systemctl enable classroom-notes
sudo systemctl restart classroom-notes

# Wait for application to start
echo "Waiting for application to start..."
for i in {1..30}; do
    if curl -s http://localhost:5000 > /dev/null; then
        echo "Application is running!"
        sudo systemctl restart nginx
        break
    fi
    echo "Waiting... ($i/30)"
    sleep 2
done

# Check if application is running
if curl -s http://localhost:5000 > /dev/null; then
    echo "Deployment completed successfully!"
    echo "Service status:"
    sudo systemctl status classroom-notes --no-pager
else
    echo "Deployment failed - application is not running"
    echo "Checking logs:"
    sudo journalctl -u classroom-notes --no-pager -n 50
    exit 1
fi 