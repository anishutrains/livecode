import os
from pathlib import Path

# AWS Configuration
AWS_ACCESS_KEY = os.getenv('AWS_ACCESS_KEY_ID')
AWS_SECRET_KEY = os.getenv('AWS_SECRET_ACCESS_KEY')
REGION = os.getenv('AWS_DEFAULT_REGION')

# Debug environment in logs
print("Environment Check:")
print(f"FLASK_ENV: {os.getenv('FLASK_ENV')}")
print(f"Has AWS_ACCESS_KEY_ID: {'Yes' if AWS_ACCESS_KEY else 'No'}")
print(f"Has AWS_SECRET_ACCESS_KEY: {'Yes' if AWS_SECRET_KEY else 'No'}")
print(f"REGION: {REGION}")

# In production, require environment variables
if os.getenv('FLASK_ENV') == 'production':
    if not all([AWS_ACCESS_KEY, AWS_SECRET_KEY, REGION]):
        raise ValueError("AWS credentials not found in environment variables") 