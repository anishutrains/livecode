#!/bin/bash

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

# Change to project directory
cd "$PROJECT_DIR"

# Set environment variables
export FLASK_ENV=development
export FLASK_APP=backend/app.py
export PYTHONPATH=$PROJECT_DIR
export FLASK_DEBUG=1

# Run Flask with debug mode
python3 -m flask run --host=0.0.0.0 --port=5000 