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
sudo chown -R ubuntu:ubuntu .
sudo chmod 600 .env

# Setup Python virtual environment
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# Create systemd service
sudo tee /etc/systemd/system/classroom-notes.service << EOF
[Unit]
Description=Classroom Notes Flask App
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/classroom-notes
Environment="PATH=/home/ubuntu/classroom-notes/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
Environment="FLASK_APP=backend/app.py"
Environment="FLASK_ENV=production"

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
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
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
sudo systemctl restart nginx

# Check if application is running
echo "Checking application status..."
sleep 5
if curl -s http://localhost:5000/health > /dev/null; then
    echo "Application is running!"
    sudo systemctl status classroom-notes --no-pager
else
    echo "Application failed to start. Checking logs:"
    sudo journalctl -u classroom-notes --no-pager -n 50
    exit 1
fi 