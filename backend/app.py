from flask import Flask, jsonify, request, render_template, redirect, url_for, session, send_from_directory, make_response
from flask_cors import CORS
import boto3
from config.aws_config import AWS_ACCESS_KEY, AWS_SECRET_KEY, REGION
from datetime import datetime, timedelta
import os
from botocore.exceptions import ClientError
import logging
from logging.handlers import RotatingFileHandler
from functools import lru_cache
import time
import sys
import traceback
from dotenv import load_dotenv
from config.config import get_config
import secrets
from urllib.parse import urlparse
from flask.sessions import SecureCookieSessionInterface

# Load environment variables
load_dotenv()

# Get base directory
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Add a persistent secret key
SECRET_KEY = 'your-super-secret-key-that-stays-the-same'  # For development
# In production, load from environment variable
SECRET_KEY = os.environ.get('FLASK_SECRET_KEY', 'your-super-secret-key-that-stays-the-same')

app = Flask(__name__, 
    template_folder=os.path.join(BASE_DIR, 'frontend', 'templates'),
    static_folder=os.path.join(BASE_DIR, 'frontend', 'static')
)
app.config.from_object(get_config())
app.config.update(
    SECRET_KEY=SECRET_KEY,
    SESSION_COOKIE_SECURE=os.environ.get('FLASK_ENV') == 'production',#True,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_NAME='livecode_session',
    PERMANENT_SESSION_LIFETIME=timedelta(hours=24)
)
CORS(app, 
    supports_credentials=True,
    resources={
        r"/*": {
            "origins": ["https://livecode.awscertif.site"],
            "methods": ["GET", "POST", "OPTIONS"],
            "allow_headers": ["Content-Type"],
            "expose_headers": ["Set-Cookie"],
            "supports_credentials": True
        }
    }
)
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
    formatter = logging.Formatter('%(asctime)s [%(levelname)s] - %(name)s - %(message)s')

    # Create handlers list
    handlers = []

    # Add console handler
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    handlers.append(console_handler)

    # Add file handler based on environment
    if is_production:
        # In production, use /var/log/classroom-notes/
        log_dir = '/var/log/classroom-notes'
    else:
        # In development, use logs/ in project directory
        log_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'logs')
    
    # Create log directory if it doesn't exist
    os.makedirs(log_dir, exist_ok=True)
    
    # Add file handler
    file_handler = logging.FileHandler(os.path.join(log_dir, 'app.log'))
    file_handler.setFormatter(formatter)
    handlers.append(file_handler)

    # Configure root logger
    logging.basicConfig(
        level=logging.INFO,
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

# Add debug logging at startup
logger.info("Starting application...")
logger.info(f"Python version: {sys.version}")
logger.info(f"Current directory: {os.getcwd()}")

# Load environment variables
load_dotenv()

# Add error logging
if __name__ != '__main__':
    import logging
    gunicorn_logger = logging.getLogger('gunicorn.error')
    app.logger.handlers = gunicorn_logger.handlers
    app.logger.setLevel(gunicorn_logger.level)

@app.before_request
def before_request():
    app.logger.info(f"Request path: {request.path}")
    app.logger.info(f"Current session: {session}")
    app.logger.info(f"Request cookies: {request.cookies}")

@app.after_request
def after_request(response):
    app.logger.info(f"Response cookies: {response.headers.get('Set-Cookie')}")
    return response

# @app.route('/')
# def index():
#     return redirect(url_for('login'))

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        data = request.get_json()
        email = data.get('email')
        password = data.get('password')

        # Check if we're in development
        is_development = os.environ.get('FLASK_ENV') != 'production'
        
        # For development, accept any login
        if is_development:
            session.clear()
            session.permanent = True
            session['user'] = email
            session['authenticated'] = True
            
            # Create response
            response = make_response(jsonify({
                "success": True,
                "redirect": "/editor"
            }))
            
            # Log session details for debugging
            app.logger.info(f"Development login - Session created: {session}")
            app.logger.info(f"Response cookies: {response.headers.get('Set-Cookie')}")
            
            return response
        
        if email == "admin@utrains.com" and password == "admin":
            # Clear and set new session
            session.clear()
            session.permanent = True
            session['user'] = email
            session['authenticated'] = True
            
            # Create response
            response = make_response(jsonify({
                "success": True,
                "redirect": "/editor"
            }))
            
            # Let Flask handle the session cookie
            return response
            
        else:
            app.logger.warning("Login failed - invalid credentials")
            return jsonify({"success": False, "error": "Invalid credentials"}), 401
                
    return render_template('login.html')

@app.route('/editor')
def editor():
    app.logger.info(f"Accessing editor. Session contents: {session}")
    app.logger.info(f"Request cookies: {request.cookies}")
    
    if 'user' not in session or not session.get('authenticated'):
        app.logger.warning("No authenticated user in session, redirecting to login")
        return redirect(url_for('login'))
    
    app.logger.info(f"User {session['user']} accessing editor")
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


@app.route('/api/classes/<classroom_id>', methods=['PUT'])
def update_class(classroom_id):
    try:
        data = request.get_json()
        class_name = data.get('class_name')
        
        if not class_name:
            return jsonify({'error': 'Class name is required'}), 400

        table = dynamodb.Table('classroom_notes')
        response = table.get_item(Key={'classroom_id': classroom_id})
        
        if 'Item' not in response:
            return jsonify({'error': 'Class not found'}), 404
            
        item = response['Item']
        item['class_name'] = class_name
        
        table.put_item(Item=item)
        
        return jsonify({'status': 'success'})
    except Exception as e:
        print('Error updating class:', str(e))
        return jsonify({'error': str(e)}), 500

@app.route('/api/classes/<classroom_id>', methods=['DELETE'])
def delete_class(classroom_id):
    try:
        table = dynamodb.Table('classroom_notes')
        table.delete_item(Key={'classroom_id': classroom_id})
        
        return jsonify({'status': 'success'})
    except Exception as e:
        print('Error deleting class:', str(e))
        return jsonify({'error': str(e)}), 500
    
@app.route('/api/update_notes', methods=['POST'])
def update_notes():
    try:
        data = request.json
        content = data.get('content', '')
        language = data.get('language', 'plaintext')
        classroom_id = data.get('classroom_id')

        if not classroom_id:
            return jsonify({'error': 'Missing classroom_id'}), 400

        table = dynamodb.Table('classroom_notes')
        table.put_item(
            Item={
                'classroom_id': classroom_id,
                'content': content,
                'language': language,  # Store the language
                'timestamp': int(time.time())
            }
        )
        
        return jsonify({'status': 'success'})
    except Exception as e:
        logger.error(f"Error updating notes: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/check-session')
def check_session():
    if 'user' in session:
        return jsonify({"authenticated": True, "user": session['user']})
    return jsonify({"authenticated": False}), 401

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

# Add favicon route with correct path
@app.route('/favicon.ico')
def favicon():
    return send_from_directory(
        os.path.join(BASE_DIR, 'frontend', 'static'),
        'favicon.ico', 
        mimetype='image/vnd.microsoft.icon'
    )

# Add static file handler for development
@app.route('/static/<path:filename>')
def serve_static(filename):
    return send_from_directory(app.static_folder, filename)

@app.route('/debug/session')
def debug_session():
    return jsonify({
        'session': dict(session),
        'cookies': {k: v for k, v in request.cookies.items()},
        'environment': os.getenv('FLASK_ENV', 'development'),
        'secure_cookie': app.config.get('SESSION_COOKIE_SECURE'),
        'cookie_domain': app.config.get('SESSION_COOKIE_DOMAIN')
    })

@app.route('/test-cookie')
def test_cookie():
    response = make_response('Setting test cookie')
    response.set_cookie(
        'test_cookie',
        'test_value',
        httponly=True,
        secure=True,
        samesite='Lax',
        domain='.livecode.awscertif.site',
        max_age=3600
    )
    return response

def get_secure_session_cookie(app, session_dict):
    session_interface = SecureCookieSessionInterface()
    serializer = session_interface.get_signing_serializer(app)
    return serializer.dumps(session_dict)

if __name__ == '__main__':
    logger.info("Starting application...")
    app.run(host='0.0.0.0', port=5000) 