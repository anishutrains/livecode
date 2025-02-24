from flask import Flask, jsonify, request, render_template, redirect, url_for, session
from flask_cors import CORS
import boto3
from config.aws_config import AWS_ACCESS_KEY, AWS_SECRET_KEY, REGION
from datetime import datetime
import os
from botocore.exceptions import ClientError
import logging
from logging.handlers import RotatingFileHandler
from functools import lru_cache
import time
import sys
import traceback

app = Flask(__name__, 
    template_folder='../frontend/templates',
    static_folder='../frontend/static'
)
app.secret_key = os.urandom(24)  # For session management
CORS(app, supports_credentials=True)
print(AWS_ACCESS_KEY)
print(AWS_SECRET_KEY)
print(REGION)

# Initialize AWS DynamoDB
dynamodb = boto3.resource('dynamodb',
    aws_access_key_id=AWS_ACCESS_KEY,
    aws_secret_access_key=AWS_SECRET_KEY,
    region_name=REGION
)

# Create DynamoDB table if it doesn't exist
def create_table_if_not_exists():
    try:
        # Check if table exists
        table = dynamodb.Table('classroom_notes')
        table.table_status
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            # Create the table
            table = dynamodb.create_table(
                TableName='classroom_notes',
                KeySchema=[
                    {
                        'AttributeName': 'classroom_id',
                        'KeyType': 'HASH'  # Partition key
                    }
                ],
                AttributeDefinitions=[
                    {
                        'AttributeName': 'classroom_id',
                        'AttributeType': 'S'  # String
                    }
                ],
                ProvisionedThroughput={
                    'ReadCapacityUnits': 5,
                    'WriteCapacityUnits': 5
                }
            )
            # Wait for the table to be created
            table.meta.client.get_waiter('table_exists').wait(TableName='classroom_notes')
        else:
            raise e
    return table

# Create table on startup
create_table_if_not_exists()

# # Initialize AWS Cognito for authentication
# cognito = boto3.client('cognito-idp',
#     aws_access_key_id=AWS_ACCESS_KEY,
#     aws_secret_access_key=AWS_SECRET_KEY,
#     region_name=REGION
# )

# Set up logging
def setup_logging():
    # Determine if we're in production
    is_production = os.environ.get('FLASK_ENV') == 'production'
    
    # Set up formatters
    default_formatter = logging.Formatter(
        '%(asctime)s [%(levelname)s] - %(name)s - %(message)s'
    )

    if is_production:
        log_dir = '/home/ubuntu/classroom-notes/logs'
        os.makedirs(log_dir, exist_ok=True)
        log_file = f'{log_dir}/app.log'
        
        # File handler for all logs
        file_handler = RotatingFileHandler(
            log_file,
            maxBytes=10000000,  # 10MB
            backupCount=5,
            mode='a'
        )
        file_handler.setFormatter(default_formatter)
        handlers = [file_handler, logging.StreamHandler()]
    else:
        # In development, just log to console
        console_handler = logging.StreamHandler()
        console_handler.setFormatter(default_formatter)
        handlers = [console_handler]

    # Configure root logger
    logging.basicConfig(
        level=logging.INFO,  # Set default level to INFO
        handlers=handlers
    )

    # Set specific log levels for different loggers
    logging.getLogger('werkzeug').setLevel(logging.INFO)
    logging.getLogger('botocore').setLevel(logging.WARNING)
    logging.getLogger('boto3').setLevel(logging.WARNING)
    logging.getLogger('urllib3').setLevel(logging.WARNING)

    # Get our app logger and set it to DEBUG
    app_logger = logging.getLogger(__name__)
    app_logger.setLevel(logging.DEBUG)
    
    return app_logger

# Initialize logger
logger = setup_logging()

# Add a startup log message
logger.info(f"Application starting up in {os.environ.get('FLASK_ENV', 'development')} mode")

# Add at the start of the file
print("Starting application...")
print(f"Python version: {sys.version}")
print(f"Current working directory: {os.getcwd()}")

@app.route('/')
def index():
    return redirect(url_for('login'))

@app.route('/login')
def login():
    return render_template('login.html')

@app.route('/editor')
def editor():
    if 'user' not in session:
        return redirect(url_for('login'))
    return render_template('editor.html')

@app.route('/view/<classroom_id>')
def viewer(classroom_id):
    return render_template('viewer.html', classroom_id=classroom_id)

@app.route('/api/login', methods=['POST'])
def login_api():
    try:
        data = request.json
        email = data.get('email')
        password = data.get('password')
        
        logger.debug(f"Login attempt for email: {email}")
        
        # For development, accept any login
        if email and password:
            session['user'] = email  # Store user in session
            logger.info(f"Successful login for {email}")
            return jsonify({
                'status': 'success',
                'message': 'Logged in successfully'
            })
        
        logger.warning(f"Failed login attempt for {email}")
        return jsonify({
            'status': 'error',
            'message': 'Invalid credentials'
        }), 401
    except Exception as e:
        logger.error(f"Login error: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

# Add cache with 2 second timeout
@lru_cache(maxsize=128)
def get_cached_notes(classroom_id, timestamp):
    """Cache notes with 2-second granularity"""
    table = dynamodb.Table('classroom_notes')
    response = table.get_item(
        Key={
            'classroom_id': classroom_id
        }
    )
    
    if 'Item' in response:
        return response['Item']
    return None

@app.route('/api/notes/<classroom_id>', methods=['GET'])
def get_notes(classroom_id):
    try:
        # Use 2-second granularity for cache
        timestamp = int(time.time() / 2)
        
        # Get cached or fresh data
        data = get_cached_notes(classroom_id, timestamp)
        
        if data:
            return jsonify({
                'content': data.get('content', ''),
                'class_name': data.get('class_name', f'Class {classroom_id.split("-")[1]}'),
                'last_updated': data.get('last_updated')
            })
        return jsonify({'content': '', 'class_name': f'Class {classroom_id.split("-")[1]}'})
    except Exception as e:
        print('Error fetching notes:', str(e))
        return jsonify({'error': str(e)}), 500

@app.route('/api/notes/<classroom_id>', methods=['POST'])
def save_notes(classroom_id):
    try:
        data = request.get_json()
        content = data.get('content', '')
        class_name = data.get('class_name')
        
        # Get existing item first
        table = dynamodb.Table('classroom_notes')
        existing_item = table.get_item(
            Key={
                'classroom_id': classroom_id
            }
        ).get('Item', {})
        
        # Keep existing class_name if not provided in request
        if not class_name:
            class_name = existing_item.get('class_name', f'Class {classroom_id.split("-")[1]}')
        
        # Clear the cache for this classroom
        get_cached_notes.cache_clear()
        
        # Update the item
        response = table.put_item(
            Item={
                'classroom_id': classroom_id,
                'content': content,
                'class_name': class_name,
                'last_updated': datetime.now().isoformat()
            }
        )
        return jsonify({'status': 'success'})
    except Exception as e:
        print('Error saving notes:', str(e))
        return jsonify({'error': str(e)}), 500

@app.route('/api/classes', methods=['GET'])
def get_classes():
    table = dynamodb.Table('classroom_notes')
    try:
        response = table.scan()
        classes = response.get('Items', [])
        
        # Filter out empty items and sort by last_updated
        classes = [c for c in classes if c.get('content') is not None]
        classes.sort(key=lambda x: x.get('last_updated', ''), reverse=True)
        
        return jsonify(classes)
    except Exception as e:
        print('Error fetching classes:', str(e))
        return jsonify({'error': str(e)}), 500

@app.route('/debug')
def debug():
    import os
    import sys
    
    debug_info = {
        'environment': dict(os.environ),
        'python_path': sys.path,
        'working_directory': os.getcwd(),
        'user': os.getuid(),
        'group': os.getgid(),
    }
    return jsonify(debug_info)

@app.route('/api/debug/dynamodb', methods=['GET'])
def debug_dynamodb():
    try:
        table = dynamodb.Table('classroom_notes')
        response = table.scan()
        items = response.get('Items', [])
        
        debug_info = {
            'table_name': 'classroom_notes',
            'item_count': len(items),
            'items': items,
            'aws_region': REGION,
            'environment': os.getenv('FLASK_ENV', 'development')
        }
        
        return jsonify(debug_info)
    except Exception as e:
        return jsonify({
            'error': str(e),
            'aws_region': REGION,
            'environment': os.getenv('FLASK_ENV', 'development')
        }), 500

@app.errorhandler(Exception)
def handle_error(error):
    print("Error occurred:", str(error))
    print("Traceback:", traceback.format_exc())
    return jsonify({
        'error': str(error),
        'traceback': traceback.format_exc()
    }), 500

@app.route('/health')
def health_check():
    try:
        # Test DynamoDB connection
        table = dynamodb.Table('classroom_notes')
        table.scan(Limit=1)
        
        return jsonify({
            'status': 'healthy',
            'environment': os.getenv('FLASK_ENV', 'development'),
            'aws_region': REGION,
            'has_aws_credentials': bool(AWS_ACCESS_KEY and AWS_SECRET_KEY)
        })
    except Exception as e:
        print("Health check failed:", str(e))
        return jsonify({
            'status': 'unhealthy',
            'error': str(e),
            'environment': os.getenv('FLASK_ENV', 'development')
        }), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000) 