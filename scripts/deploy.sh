#!/bin/bash

# Enable error logging
set -e

echo "Starting deployment..."

# Install required packages
sudo apt-get update
sudo apt-get install -y python3-pip python3-venv nginx

# Create and setup application directory
cd /home/ubuntu/classroom-notes

# Setup Python virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
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

ExecStart=/home/ubuntu/classroom-notes/venv/bin/python backend/app.py

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
    }
}
EOF

# Enable site
sudo ln -sf /etc/nginx/sites-available/classroom-notes /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Restart services
sudo systemctl daemon-reload
sudo systemctl restart classroom-notes
sudo systemctl restart nginx

echo "Deployment completed!" 