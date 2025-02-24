#!/bin/bash

# Enable error logging
set -e
exec 2> >(tee -a /home/ubuntu/deploy-error.log >&2)

# Log start of deployment
echo "Starting deployment at $(date)"
echo "Current working directory: $(pwd)"

# Create required directories with proper permissions
sudo mkdir -p /home/ubuntu/classroom-notes/logs
sudo chown -R ubuntu:ubuntu /home/ubuntu/classroom-notes
sudo chmod -R 755 /home/ubuntu/classroom-notes/logs

# Install required packages
sudo apt-get update
sudo apt-get install -y python3-pip python3-venv nginx

# Set up Python virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Create Gunicorn service with environment variables
sudo tee /etc/systemd/system/classroom-notes.service << EOF
[Unit]
Description=Classroom Notes Flask App
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/classroom-notes
Environment="PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/home/ubuntu/classroom-notes/venv/bin"
Environment="FLASK_APP=backend/app.py"
Environment="FLASK_ENV=production"
Environment="AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}"
Environment="AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}"
Environment="AWS_DEFAULT_REGION=${AWS_REGION}"
Environment="PYTHONPATH=/home/ubuntu/classroom-notes"

# Create log files if they don't exist
ExecStartPre=/bin/bash -c 'touch /home/ubuntu/classroom-notes/logs/gunicorn.log /home/ubuntu/classroom-notes/logs/access.log /home/ubuntu/classroom-notes/logs/error.log'
ExecStartPre=/bin/bash -c 'chown ubuntu:ubuntu /home/ubuntu/classroom-notes/logs/*.log'
ExecStartPre=/bin/bash -c 'printenv > /home/ubuntu/classroom-notes/logs/env.log'

ExecStart=/home/ubuntu/classroom-notes/venv/bin/gunicorn \
    --workers 3 \
    --bind 127.0.0.1:5000 \
    --log-file /home/ubuntu/classroom-notes/logs/gunicorn.log \
    --access-logfile /home/ubuntu/classroom-notes/logs/access.log \
    --error-logfile /home/ubuntu/classroom-notes/logs/error.log \
    --capture-output \
    --enable-stdio-inheritance \
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

    access_log /home/ubuntu/classroom-notes/logs/nginx-access.log;
    error_log /home/ubuntu/classroom-notes/logs/nginx-error.log;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

# Enable Nginx site
sudo ln -sf /etc/nginx/sites-available/classroom-notes /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test Nginx configuration
sudo nginx -t

# Start services
sudo systemctl daemon-reload
sudo systemctl enable classroom-notes
sudo systemctl restart classroom-notes

# Wait for log files to be created
sleep 2

# Check logs for errors
echo "Checking service logs..."
sudo journalctl -u classroom-notes -n 50 --no-pager || true
echo "Checking gunicorn log..."
cat /home/ubuntu/classroom-notes/logs/gunicorn.log || true
echo "Checking error log..."
cat /home/ubuntu/classroom-notes/logs/error.log || true

# Wait for Gunicorn with better debugging
echo "Waiting for Gunicorn to start..."
for i in {1..30}; do
    echo "Attempt $i: Checking Gunicorn status..."
    if sudo systemctl is-active classroom-notes >/dev/null 2>&1; then
        echo "Service is active"
        if curl -s http://127.0.0.1:5000/health >/dev/null; then
            echo "Gunicorn is running!"
            break
        fi
    else
        echo "Service is not active, checking status:"
        sudo systemctl status classroom-notes --no-pager
    fi
    echo "Waiting... ($i/30)"
    sleep 2
done

# Start nginx only if Gunicorn is running
if curl -s http://127.0.0.1:5000/health >/dev/null; then
    sudo systemctl restart nginx
    echo "Nginx started successfully"
else
    echo "Error: Gunicorn is not running. Checking logs:"
    sudo systemctl status classroom-notes --no-pager
    cat /home/ubuntu/classroom-notes/logs/gunicorn.log
    cat /home/ubuntu/classroom-notes/logs/error.log
    exit 1
fi

# Log deployment completion
echo "Deployment completed at $(date)" 