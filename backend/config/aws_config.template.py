import os
from dotenv import load_dotenv
from pathlib import Path

# Get the base directory (project root)
base_dir = Path(__file__).resolve().parent.parent.parent

# Load environment variables from .env file in project root
load_dotenv(base_dir / '.env')

# AWS Configuration
AWS_ACCESS_KEY = os.getenv('AWS_ACCESS_KEY_ID')
AWS_SECRET_KEY = os.getenv('AWS_SECRET_ACCESS_KEY')
REGION = os.getenv('AWS_DEFAULT_REGION')

# In production, require environment variables
if os.getenv('FLASK_ENV') == 'production':
    if not all([AWS_ACCESS_KEY, AWS_SECRET_KEY, REGION]):
        raise ValueError("AWS credentials not found in environment variables") 