import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

class Config:
    DEBUG = False
    TESTING = False
    STATIC_FOLDER = os.path.join(BASE_DIR, 'frontend', 'static')
    TEMPLATE_FOLDER = os.path.join(BASE_DIR, 'frontend', 'templates')

class DevelopmentConfig(Config):
    DEBUG = True
    ENV = 'development'

class ProductionConfig(Config):
    ENV = 'production'

# Get config based on environment
def get_config():
    env = os.getenv('FLASK_ENV', 'development')
    if env == 'production':
        return ProductionConfig
    return DevelopmentConfig 