#!/bin/bash

# Install required packages
sudo apt-get update
sudo apt-get install -y python3-pip python3-venv nginx

# Create application directory
mkdir -p /home/ubuntu/classroom-notes
cd /home/ubuntu/classroom-notes

# Set up Python virtual environment
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Create Gunicorn service with environment variables
sudo tee /etc/systemd/system/classroom-notes.service << EOF
[Unit]
Description=Classroom Notes Flask App
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/classroom-notes
Environment="PATH=/home/ubuntu/classroom-notes/venv/bin"
Environment="FLASK_APP=backend/app.py"
Environment="FLASK_ENV=production"
Environment="AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID"
Environment="AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY"
Environment="AWS_REGION=$AWS_REGION"
ExecStart=/home/ubuntu/classroom-notes/venv/bin/gunicorn --bind 127.0.0.1:5000 backend.app:app

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

# Enable Nginx site
sudo ln -sf /etc/nginx/sites-available/classroom-notes /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Start services
sudo systemctl daemon-reload
sudo systemctl enable classroom-notes
sudo systemctl restart classroom-notes
sudo systemctl restart nginx 