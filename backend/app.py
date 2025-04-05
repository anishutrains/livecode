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

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import random
import string
from datetime import datetime, timedelta
from werkzeug.security import generate_password_hash, check_password_hash

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
    SESSION_COOKIE_SECURE=os.environ.get('FLASK_ENV') == 'production',
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_NAME='livecode_session',
    PERMANENT_SESSION_LIFETIME=timedelta(hours=24),
    SESSION_COOKIE_DOMAIN='.livecode.awscertif.site' if os.environ.get('FLASK_ENV') == 'production' else None
)

# Configure session interface
app.session_interface = SecureCookieSessionInterface()

# Initialize CORS
CORS(app, supports_credentials=True, resources={
    r"/*": {
        "origins": ["https://livecode.awscertif.site", "http://localhost:5000"],
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization", "X-Requested-With"],
        "expose_headers": ["Content-Type", "Authorization", "Set-Cookie"],
        "supports_credentials": True,
        "max_age": 3600
    }
})

# Initialize DynamoDB
dynamodb = boto3.resource('dynamodb',
    aws_access_key_id=AWS_ACCESS_KEY,
    aws_secret_access_key=AWS_SECRET_KEY,
    region_name=REGION
)

# Create a new DynamoDB table for users if it doesn't exist
def create_users_table():
    try:
        table = dynamodb.Table('users')
        table.table_status
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            table = dynamodb.create_table(
                TableName='users',
                KeySchema=[
                    {
                        'AttributeName': 'email',
                        'KeyType': 'HASH'
                    }
                ],
                AttributeDefinitions=[
                    {
                        'AttributeName': 'email',
                        'AttributeType': 'S'
                    }
                ],
                ProvisionedThroughput={
                    'ReadCapacityUnits': 5,
                    'WriteCapacityUnits': 5
                }
            )
            table.meta.client.get_waiter('table_exists').wait(TableName='users')
    return table

# Create users table on startup
create_users_table()

# Create DynamoDB table if it doesn't exist
def create_table_if_not_exists():
    try:
        table = dynamodb.Table('live_notes')
        table.table_status
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            table = dynamodb.create_table(
                TableName='live_notes',
                KeySchema=[
                    {
                        'AttributeName': 'classroom_id',
                        'KeyType': 'HASH'  # Partition key
                    }
                ],
                AttributeDefinitions=[
                    {
                        'AttributeName': 'classroom_id',
                        'AttributeType': 'S'
                    },
                    {
                        'AttributeName': 'user_email',
                        'AttributeType': 'S'
                    }
                ],
                GlobalSecondaryIndexes=[
                    {
                        'IndexName': 'user_email_index',
                        'KeySchema': [
                            {
                                'AttributeName': 'user_email',
                                'KeyType': 'HASH'
                            }
                        ],
                        'Projection': {
                            'ProjectionType': 'ALL'
                        },
                        'ProvisionedThroughput': {
                            'ReadCapacityUnits': 5,
                            'WriteCapacityUnits': 5
                        }
                    }
                ],
                ProvisionedThroughput={
                    'ReadCapacityUnits': 5,
                    'WriteCapacityUnits': 5
                }
            )
            table.meta.client.get_waiter('table_exists').wait(TableName='live_notes')
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

    # Always use logs/ in the app directory for consistency
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
        remember = data.get('remember', False)

        # Log login attempt with more details
        app.logger.info(f"Login attempt for email: {email}, remember: {remember}")
        app.logger.info(f"Request headers: {dict(request.headers)}")
        app.logger.info(f"Request cookies: {dict(request.cookies)}")
        
        # Get user data
        users_table = dynamodb.Table('users')
        try:
            app.logger.info(f"Attempting to fetch user from DynamoDB: {email}")
            user = users_table.get_item(
                Key={'email': email}
            ).get('Item')
            
            if user:
                app.logger.info(f"User found in database: {email}")
                app.logger.info(f"User verified status: {user.get('verified', False)}")
            else:
                app.logger.warning(f"User not found in database: {email}")
        except Exception as e:
            app.logger.error(f"Error accessing DynamoDB: {str(e)}")
            app.logger.error(f"Traceback: {traceback.format_exc()}")
            return jsonify({'success': False, 'error': 'Server error'}), 500

        # For development, accept any login
        is_development = os.environ.get('FLASK_ENV') != 'production'
        app.logger.info(f"Environment: {'development' if is_development else 'production'}")
        
        if is_development:
            app.logger.info(f"Development mode: accepting login for {email}")
            session.clear()
            session.permanent = True
            session['user'] = email
            session['authenticated'] = True
            
            # Log session details for debugging
            app.logger.info(f"Development login - Session created: {session}")
            app.logger.info(f"Session ID: {session.sid if hasattr(session, 'sid') else 'No session ID'}")
            
            # Force the session to be saved immediately
            session.modified = True
            
            return jsonify({
                "success": True,
                "redirect": "/editor",
                "session_id": session.sid if hasattr(session, 'sid') else None
            })
        
        # In production, check if user exists and is verified
        if not user:
            app.logger.warning(f"Login failed: User not found - {email}")
            return jsonify({'success': False, 'error': 'Invalid credentials'}), 401

        if not user.get('verified', False):
            app.logger.warning(f"Login failed: User not verified - {email}")
            return jsonify({'success': False, 'error': 'Please verify your email first'}), 401

        # Check password
        app.logger.info(f"Checking password for user: {email}")
        if check_password_hash(user['password_hash'], password):
            app.logger.info(f"Password verified for user: {email}")
            session.clear()
            session.permanent = True
            session['user'] = email
            session['authenticated'] = True
            
            # Force the session to be saved
            session.modified = True
            
            app.logger.info(f"Production login successful - Session created: {session}")
            app.logger.info(f"Session ID: {session.sid if hasattr(session, 'sid') else 'No session ID'}")
            
            return jsonify({
                'success': True, 
                'redirect': '/editor',
                "session_id": session.sid if hasattr(session, 'sid') else None
            })
        
        app.logger.warning(f"Login failed: Invalid password - {email}")
        return jsonify({'success': False, 'error': 'Invalid credentials'}), 401
                
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
    table = dynamodb.Table('live_notes')
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
        # Check if this is a view-only request (from shared link)
        is_view_only = request.args.get('view') == 'true'
        allow_edit = request.args.get('edit') == 'true'
        
        # Get cached or fresh data
        timestamp = int(time.time() / 2)
        data = get_cached_notes(classroom_id, timestamp)
        
        if data:
            if is_view_only:
                # For view-only access, return content without checking authentication
                return jsonify({
                    'content': data.get('content', ''),
                    'class_name': data.get('class_name', f'Class {classroom_id.split("-")[1]}'),
                    'last_updated': data.get('last_updated'),
                    'view_only': not allow_edit,
                    'allow_edit': allow_edit
                })
            else:
                # For editor access, check authentication
                if 'user' not in session:
                    return jsonify({'error': 'Not authenticated'}), 401
                
                # Check if the note belongs to the user
                if data.get('user_email') != session['user']:
                    return jsonify({'error': 'Unauthorized access'}), 403
                
                return jsonify({
                    'content': data.get('content', ''),
                    'class_name': data.get('class_name', f'Class {classroom_id.split("-")[1]}'),
                    'last_updated': data.get('last_updated'),
                    'view_only': False,
                    'allow_edit': True
                })
                
        return jsonify({
            'content': '',
            'class_name': f'Class {classroom_id.split("-")[1]}',
            'view_only': not allow_edit,
            'allow_edit': allow_edit
        })
    except Exception as e:
        print('Error fetching notes:', str(e))
        return jsonify({'error': str(e)}), 500

@app.route('/api/notes/<classroom_id>', methods=['POST'])
def save_notes(classroom_id):
    # Check if it's an edit from view mode
    is_view_edit = request.args.get('view') == 'true' and request.args.get('edit') == 'true'
    
    # If it's not view edit mode, ensure user is authenticated
    if not is_view_edit and 'user' not in session:
        return jsonify({'error': 'Not authenticated'}), 401

    try:
        data = request.get_json()
        content = data.get('content', '')
        class_name = data.get('class_name')
        
        # Get user email (if authenticated) or use 'shared_editor' for view edit mode
        user_email = session.get('user') if 'user' in session else 'shared_editor'
        
        # Get existing item first
        table = dynamodb.Table('live_notes')
        existing_item = table.get_item(
            Key={
                'classroom_id': classroom_id
            }
        ).get('Item', {})
        
        # For regular (non-view) mode, check if user owns the note
        if not is_view_edit and existing_item and existing_item.get('user_email') != user_email:
            return jsonify({'error': 'Unauthorized access'}), 403
        
        # Keep existing class_name if not provided in request
        if not class_name:
            class_name = existing_item.get('class_name', f'Class {classroom_id.split("-")[1]}')
        
        # Clear the cache for this classroom
        get_cached_notes.cache_clear()
        
        # Preserve original owner when editing in view mode
        if is_view_edit and existing_item and 'user_email' in existing_item:
            user_email = existing_item['user_email']
        
        # Update the item
        response = table.put_item(
            Item={
                'classroom_id': classroom_id,
                'user_email': user_email,
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
    if 'user' not in session:
        app.logger.warning("User not authenticated in session when trying to get classes")
        return jsonify({'error': 'Not authenticated'}), 401

    user_email = session['user']
    app.logger.info(f"Getting classes for user: {user_email}")
    
    table = dynamodb.Table('live_notes')
    
    try:
        # Query using the GSI
        response = table.query(
            IndexName='user_email_index',
            KeyConditionExpression='user_email = :email',
            ExpressionAttributeValues={
                ':email': user_email
            }
        )
        
        classes = response.get('Items', [])
        
        # Filter out empty items and sort by last_updated
        classes = [c for c in classes if c.get('content') is not None]
        classes.sort(key=lambda x: x.get('last_updated', ''), reverse=True)
        
        app.logger.info(f"Found {len(classes)} classes for user {user_email}")
        return jsonify(classes)
    except Exception as e:
        app.logger.error(f"Error fetching classes: {str(e)}")
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
        table = dynamodb.Table('live_notes')
        response = table.scan()
        items = response.get('Items', [])
        
        debug_info = {
            'table_name': 'live_notes',
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
    if 'user' not in session:
        return jsonify({'error': 'Not authenticated'}), 401

    try:
        data = request.get_json()
        class_name = data.get('class_name')
        user_email = session['user']
        
        if not class_name:
            return jsonify({'error': 'Class name is required'}), 400

        table = dynamodb.Table('live_notes')
        response = table.get_item(Key={'classroom_id': classroom_id})
        
        if 'Item' not in response:
            return jsonify({'error': 'Class not found'}), 404
            
        item = response['Item']
        
        # Check if the note belongs to the user
        if item.get('user_email') != user_email:
            return jsonify({'error': 'Unauthorized access'}), 403
            
        item['class_name'] = class_name
        
        table.put_item(Item=item)
        
        return jsonify({'status': 'success'})
    except Exception as e:
        print('Error updating class:', str(e))
        return jsonify({'error': str(e)}), 500

@app.route('/api/classes/<classroom_id>', methods=['DELETE'])
def delete_class(classroom_id):
    if 'user' not in session:
        return jsonify({'error': 'Not authenticated'}), 401

    try:
        table = dynamodb.Table('live_notes')
        
        # Check ownership before deleting
        response = table.get_item(Key={'classroom_id': classroom_id})
        if 'Item' in response:
            item = response['Item']
            if item.get('user_email') != session['user']:
                return jsonify({'error': 'Unauthorized access'}), 403
        
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

        table = dynamodb.Table('live_notes')
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

def send_verification_email(email, otp):
    sender_email = "anish.kumar@utrains.org"  # Replace with your email
    sender_password = "ntnmofoxxtyfiaqs"   # Replace with your app password

    msg = MIMEMultipart()
    msg['From'] = sender_email
    msg['To'] = email
    msg['Subject'] = "Verify Your LiveCode Account"

    body = f"""
    Welcome to LiveCode!
    
    Your verification code is: {otp}
    
    This code will expire in 10 minutes.
    
    If you didn't request this code, please ignore this email.
    """
    
    msg.attach(MIMEText(body, 'plain'))

    try:
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(sender_email, sender_password)
        server.send_message(msg)
        server.quit()
        return True
    except Exception as e:
        print(f"Failed to send email: {str(e)}")
        return False

def generate_otp():
    return ''.join(random.choices(string.digits, k=6))

@app.route('/signup', methods=['GET'])
def signup_page():
    return render_template('signup.html')

@app.route('/verify', methods=['GET'])
def verify_page():
    return render_template('verify.html')

@app.route('/api/signup', methods=['POST'])
def signup():
    try:
        data = request.get_json()
        name = data.get('name')
        email = data.get('email')
        password = data.get('password')

        if not all([name, email, password]):
            return jsonify({'success': False, 'error': 'All fields are required'}), 400

        # Check if user already exists
        users_table = dynamodb.Table('users')
        existing_user = users_table.get_item(
            Key={'email': email}
        ).get('Item')

        if existing_user:
            return jsonify({'success': False, 'error': 'Email already registered'}), 400

        # Generate OTP and expiration time
        otp = generate_otp()
        otp_expiry = (datetime.now() + timedelta(minutes=10)).isoformat()

        # Store user data with verification status
        users_table.put_item(
            Item={
                'email': email,
                'name': name,
                'password_hash': generate_password_hash(password),
                'verified': False,
                'otp': otp,
                'otp_expiry': otp_expiry,
                'created_at': datetime.now().isoformat()
            }
        )

        # Send verification email
        if send_verification_email(email, otp):
            return jsonify({'success': True})
        else:
            return jsonify({'success': False, 'error': 'Failed to send verification email'}), 500

    except Exception as e:
        print(f"Signup error: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/verify', methods=['POST'])
def verify():
    try:
        data = request.get_json()
        email = data.get('email')
        otp = data.get('otp')

        if not all([email, otp]):
            return jsonify({'success': False, 'error': 'Email and OTP are required'}), 400

        # Get user data
        users_table = dynamodb.Table('users')
        user = users_table.get_item(
            Key={'email': email}
        ).get('Item')

        if not user:
            return jsonify({'success': False, 'error': 'User not found'}), 404

        # Check if OTP is expired
        otp_expiry = datetime.fromisoformat(user['otp_expiry'])
        if datetime.now() > otp_expiry:
            return jsonify({'success': False, 'error': 'OTP has expired'}), 400

        # Verify OTP
        if user['otp'] != otp:
            return jsonify({'success': False, 'error': 'Invalid OTP'}), 400

        # Update user verification status
        users_table.update_item(
            Key={'email': email},
            UpdateExpression='SET verified = :val',
            ExpressionAttributeValues={':val': True}
        )

        return jsonify({'success': True})

    except Exception as e:
        print(f"Verification error: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/resend-otp', methods=['POST'])
def resend_otp():
    try:
        data = request.get_json()
        email = data.get('email')

        if not email:
            return jsonify({'success': False, 'error': 'Email is required'}), 400

        # Get user data
        users_table = dynamodb.Table('users')
        user = users_table.get_item(
            Key={'email': email}
        ).get('Item')

        if not user:
            return jsonify({'success': False, 'error': 'User not found'}), 404

        # Generate new OTP and expiration time
        new_otp = generate_otp()
        new_otp_expiry = (datetime.now() + timedelta(minutes=10)).isoformat()

        # Update user with new OTP
        users_table.update_item(
            Key={'email': email},
            UpdateExpression='SET otp = :otp, otp_expiry = :expiry',
            ExpressionAttributeValues={
                ':otp': new_otp,
                ':expiry': new_otp_expiry
            }
        )

        # Send new verification email
        if send_verification_email(email, new_otp):
            return jsonify({'success': True})
        else:
            return jsonify({'success': False, 'error': 'Failed to send verification email'}), 500

    except Exception as e:
        print(f"Resend OTP error: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/check-session')
def check_session():
    app.logger.info(f"Check session called. Session: {session}")
    
    if 'user' in session and session.get('authenticated'):
        # Return the user email for the frontend
        return jsonify({
            "authenticated": True, 
            "user": session['user'],
            "timestamp": datetime.now().isoformat()
        })
    
    app.logger.warning("Session check failed - not authenticated")
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
        table = dynamodb.Table('live_notes')
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
    """Debug endpoint to check session status"""
    if os.environ.get('FLASK_ENV') != 'production':
        session_info = {
            'session_exists': bool(session),
            'session_contents': dict(session),
            'cookies': dict(request.cookies),
            'headers': dict(request.headers),
            'is_authenticated': session.get('authenticated', False),
            'user': session.get('user', None),
            'session_cookie_name': app.config.get('SESSION_COOKIE_NAME'),
            'session_cookie_secure': app.config.get('SESSION_COOKIE_SECURE'),
            'session_cookie_httponly': app.config.get('SESSION_COOKIE_HTTPONLY'),
            'session_cookie_samesite': app.config.get('SESSION_COOKIE_SAMESITE'),
            'permanent_session_lifetime': str(app.config.get('PERMANENT_SESSION_LIFETIME')),
            'secret_key_configured': bool(app.config.get('SECRET_KEY')),
            'flask_env': os.environ.get('FLASK_ENV')
        }
        return jsonify(session_info)
    else:
        return jsonify({'error': 'Debug endpoints disabled in production'}), 403

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

@app.route('/debug/login', methods=['GET'])
def debug_login():
    """Debug endpoint to check login-related settings"""
    if os.environ.get('FLASK_ENV') != 'production':
        # Check DynamoDB connection
        dynamodb_status = "Unknown"
        try:
            users_table = dynamodb.Table('users')
            users_table.scan(Limit=1)
            dynamodb_status = "Connected"
        except Exception as e:
            dynamodb_status = f"Error: {str(e)}"
        
        # Check session configuration
        session_config = {
            'session_cookie_name': app.config.get('SESSION_COOKIE_NAME'),
            'session_cookie_secure': app.config.get('SESSION_COOKIE_SECURE'),
            'session_cookie_httponly': app.config.get('SESSION_COOKIE_HTTPONLY'),
            'session_cookie_samesite': app.config.get('SESSION_COOKIE_SAMESITE'),
            'permanent_session_lifetime': str(app.config.get('PERMANENT_SESSION_LIFETIME')),
            'secret_key_configured': bool(app.config.get('SECRET_KEY')),
            'flask_env': os.environ.get('FLASK_ENV')
        }
        
        # Check CORS configuration
        cors_config = {
            'supports_credentials': app.config.get('CORS_SUPPORTS_CREDENTIALS', False),
            'origins': app.config.get('CORS_ORIGINS', []),
            'methods': app.config.get('CORS_METHODS', []),
            'allow_headers': app.config.get('CORS_ALLOW_HEADERS', []),
            'expose_headers': app.config.get('CORS_EXPOSE_HEADERS', [])
        }
        
        debug_info = {
            'dynamodb_status': dynamodb_status,
            'session_config': session_config,
            'cors_config': cors_config,
            'request_headers': dict(request.headers),
            'request_cookies': dict(request.cookies),
            'current_session': dict(session) if session else None
        }
        
        return jsonify(debug_info)
    else:
        return jsonify({'error': 'Debug endpoints disabled in production'}), 403

@app.route('/debug/login-status', methods=['GET'])
def debug_login_status():
    """Debug endpoint to check login status"""
    if os.environ.get('FLASK_ENV') != 'production':
        # Check if user is authenticated
        is_authenticated = 'user' in session and session.get('authenticated', False)
        
        # Get user data if authenticated
        user_data = None
        if is_authenticated:
            try:
                users_table = dynamodb.Table('users')
                user = users_table.get_item(
                    Key={'email': session['user']}
                ).get('Item')
                
                if user:
                    # Remove sensitive data
                    user_data = {
                        'email': user.get('email'),
                        'name': user.get('name'),
                        'verified': user.get('verified', False),
                        'created_at': user.get('created_at')
                    }
            except Exception as e:
                user_data = {'error': str(e)}
        
        # Get session data
        session_data = {
            'session_exists': bool(session),
            'session_contents': dict(session),
            'is_authenticated': is_authenticated,
            'user': session.get('user') if is_authenticated else None
        }
        
        # Get cookie data
        cookie_data = {
            'cookies': dict(request.cookies),
            'session_cookie': request.cookies.get(app.config.get('SESSION_COOKIE_NAME'))
        }
        
        debug_info = {
            'is_authenticated': is_authenticated,
            'user_data': user_data,
            'session_data': session_data,
            'cookie_data': cookie_data,
            'request_headers': dict(request.headers)
        }
        
        return jsonify(debug_info)
    else:
        return jsonify({'error': 'Debug endpoints disabled in production'}), 403

if __name__ == '__main__':
    logger.info("Starting application...")
    app.run(host='0.0.0.0', port=5000) 