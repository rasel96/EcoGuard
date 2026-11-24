
# ============================================================
# IMPORTS
# ============================================================

import io
import logging
import os
import re
import smtplib

from functools import wraps
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

from flask import (
    Flask,
    render_template,
    request,
    redirect,
    url_for,
    session,
    flash,
    jsonify,
    send_file
)

from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS

from flask_wtf.csrf import CSRFProtect, CSRFError, generate_csrf

from werkzeug.security import (
    generate_password_hash,
    check_password_hash
)

from itsdangerous import (
    URLSafeTimedSerializer,
    BadSignature,
    SignatureExpired
)

from sqlalchemy import text, func
from dotenv import load_dotenv

from gee_service import analyze_area, analyze_green_coverage
from location_service import get_location, suggest_locations

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("ecoguard")


def utc_now():
    """Return timezone-naive UTC datetime compatible with existing SQLite rows."""
    return datetime.now(timezone.utc).replace(tzinfo=None)



# ============================================================
# 1. CONFIGURATION
# ============================================================

BASE_DIR = os.path.abspath(os.path.dirname(__file__))

load_dotenv(os.path.join(BASE_DIR, ".env"))

app = Flask(
    __name__,
    template_folder="templates",
    static_folder="static"
)

# Secret key MUST be configured before CSRF initialization
_default_secret_key = "CHANGE-THIS-TO-A-LONG-RANDOM-SECRET-KEY"
app.config["SECRET_KEY"] = os.getenv(
    "SECRET_KEY",
    _default_secret_key
)
if app.config["SECRET_KEY"] == _default_secret_key:
    logger.warning(
        "Using default SECRET_KEY. Set a strong SECRET_KEY in .env for production."
    )

# Database (supports SQLite locally and PostgreSQL/Neon via DATABASE_URL)
def _normalize_database_url(raw_url):
    if raw_url.startswith("postgres://"):
        return "postgresql+psycopg://" + raw_url[len("postgres://"):]
    if raw_url.startswith("postgresql://"):
        return "postgresql+psycopg://" + raw_url[len("postgresql://"):]
    return raw_url


default_db_uri = (
    "sqlite:///" +
    os.path.join(BASE_DIR, "database.db").replace("\\", "/")
)
_db_uri = _normalize_database_url(os.getenv("DATABASE_URL", default_db_uri).strip() or default_db_uri)
app.config["SQLALCHEMY_DATABASE_URI"] = _db_uri

app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

if _db_uri.startswith("sqlite"):
    app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
        "connect_args": {"timeout": 30}
    }
else:
    app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
        "pool_pre_ping": True,
        "pool_recycle": 300,
    }

# Session security
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"

app.config["SESSION_COOKIE_SECURE"] = (
    os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true"
)

app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=7)
app.config["SESSION_REFRESH_EACH_REQUEST"] = True

# CSRF configuration
app.config["WTF_CSRF_ENABLED"] = True
app.config["WTF_CSRF_TIME_LIMIT"] = 3600

# Initialize CSRF ONLY ONCE, after configuration
csrf = CSRFProtect(app)

# Register CSRF token in Jinja templates
app.jinja_env.globals["csrf_token"] = generate_csrf

# Initialize SQLAlchemy
db = SQLAlchemy(app)

# Configure CORS for the Next.js frontend
_allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "FRONTEND_ORIGIN",
        "http://localhost:3000,http://127.0.0.1:3000"
    ).split(",")
    if origin.strip()
]
CORS(
    app,
    resources={r"/api/*": {"origins": _allowed_origins}},
    supports_credentials=True,
)

GREEN_TARGET = float(os.getenv("GREEN_TARGET", 60))
TREES_PER_HECTARE = int(os.getenv("TREES_PER_HECTARE", 400))

TOKEN_MAX_AGE = 60 * 60 * 24
RESET_TOKEN_MAX_AGE = 60 * 30

print("EcoGuard configuration loaded.", flush=True)


# ============================================================
# 2. TOKEN GENERATOR
# ============================================================

def get_token_serializer():

    return URLSafeTimedSerializer(
        app.config["SECRET_KEY"]
    )


def generate_email_token(email, purpose):

    serializer = get_token_serializer()

    return serializer.dumps(
        email,
        salt=f"ecoguard-{purpose}"
    )


def verify_email_token(token, purpose, max_age):

    serializer = get_token_serializer()

    try:

        email = serializer.loads(
            token,
            salt=f"ecoguard-{purpose}",
            max_age=max_age
        )

        return email

    except (SignatureExpired, BadSignature):

        return None


# ============================================================
# 3. EMAIL CONFIGURATION
# ============================================================


def send_system_email(recipient, subject, body):

    mail_username = os.getenv("MAIL_USERNAME")
    mail_password = os.getenv("MAIL_PASSWORD")

    if not mail_username or not mail_password:
        print(
            "Email error: MAIL_USERNAME or MAIL_PASSWORD is missing.",
            flush=True
        )
        return False

    try:
        message = EmailMessage()
        message["Subject"] = subject
        message["From"] = mail_username
        message["To"] = recipient
        message.set_content(body)

        # Gmail SSL connection
        with smtplib.SMTP_SSL(
            "smtp.gmail.com",
            465,
            timeout=30
        ) as server:

            server.login(mail_username, mail_password)
            server.send_message(message)

        print("Email sent successfully.", flush=True)
        return True

    except Exception as error:
        print("Email sending error:", repr(error), flush=True)
        return False


def send_verification_email(user):

    token = generate_email_token(
        user.email,
        "email-verification"
    )

    verification_url = url_for(
        "verify_email",
        token=token,
        _external=True
    )

    body = f"""
Hello {user.full_name or user.username},

Welcome to EcoGuard!

Thank you for creating your EcoGuard account.

Please verify your email address by opening this link:

{verification_url}

This verification link will expire in 24 hours.

If you did not create this account, you can ignore this email.

Regards,
EcoGuard Team
Forest Monitoring System
"""

    return send_system_email(
        user.email,
        "Verify Your EcoGuard Account",
        body
    )


def send_password_reset_email(user):

    token = generate_email_token(
        user.email,
        "password-reset"
    )

    reset_url = url_for(
        "reset_password",
        token=token,
        _external=True
    )

    body = f"""
Hello {user.full_name or user.username},

We received a request to reset your EcoGuard password.

Open the link below to create a new password:

{reset_url}

This link will expire in 30 minutes.

If you did not request a password reset, ignore this email.

Regards,
EcoGuard Team
"""

    return send_system_email(
        user.email,
        "EcoGuard Password Reset",
        body
    )



# ============================================================
# 4. LOAD MACHINE LEARNING MODEL
# ============================================================

model = None
encoder = None

try:
    import joblib

    model_path = os.path.join(BASE_DIR, "model.pkl")
    encoder_path = os.path.join(BASE_DIR, "encoder.pkl")

    if os.path.exists(model_path):
        model = joblib.load(model_path)
        print("ML model loaded successfully.", flush=True)
    else:
        print("Warning: model.pkl not found.", flush=True)

    if os.path.exists(encoder_path):
        encoder = joblib.load(encoder_path)
        print("Encoder loaded successfully.", flush=True)
    else:
        print("Warning: encoder.pkl not found.", flush=True)

except Exception as error:
    model = None
    encoder = None
    print("ML loading error:", error, flush=True)

# ============================================================
# 5. DATABASE MODELS
# ============================================================

class User(db.Model):

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    full_name = db.Column(
        db.String(150),
        nullable=True
    )

    username = db.Column(
        db.String(100),
        unique=True,
        nullable=False
    )

    email = db.Column(
        db.String(255),
        nullable=True
    )

    password = db.Column(
        db.String(255),
        nullable=False
    )

    is_verified = db.Column(
        db.Boolean,
        nullable=False,
        default=False
    )

    token_version = db.Column(
        db.Integer,
        nullable=False,
        default=1
    )

    created_at = db.Column(
        db.DateTime,
        default=utc_now
    )


class Alert(db.Model):

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    location = db.Column(
        db.String(200),
        nullable=False
    )

    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)

    risk_level = db.Column(db.String(50))
    status = db.Column(db.String(30), nullable=False, default="open")
    notes = db.Column(db.Text, nullable=True)
    ndvi = db.Column(db.Float)
    vegetation_loss = db.Column(db.Float)

    email_status = db.Column(db.String(100))
    sms_status = db.Column(db.String(100))
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)

    created_at = db.Column(
        db.DateTime,
        default=utc_now
    )


class AnalysisRun(db.Model):

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    location = db.Column(db.String(255), nullable=False)
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    geometry_type = db.Column(db.String(50), default="bounding_box")

    risk_level = db.Column(db.String(50))
    confidence = db.Column(db.Float)
    current_ndvi = db.Column(db.Float)
    vegetation_loss = db.Column(db.Float)
    coverage_percent = db.Column(db.Float)
    rainfall = db.Column(db.Float)

    metrics_json = db.Column(db.Text)
    ai_briefing = db.Column(db.Text)
    ai_model = db.Column(db.String(120))

    created_at = db.Column(db.DateTime, default=utc_now)


class Watchlist(db.Model):

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    name = db.Column(db.String(255), nullable=False)
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    boundingbox_json = db.Column(db.Text)
    geojson_json = db.Column(db.Text)
    target_coverage = db.Column(db.Float, default=60.0)
    last_risk = db.Column(db.String(50))
    last_ndvi = db.Column(db.Float)
    last_checked_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=utc_now)


class Feedback(db.Model):

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    rating = db.Column(
        db.Integer,
        nullable=False
    )

    category = db.Column(db.String(100))

    message = db.Column(
        db.Text,
        nullable=False
    )

    created_at = db.Column(
        db.DateTime,
        default=utc_now
    )


# ============================================================
# 6. DATABASE MIGRATION
# ============================================================

def migrate_existing_database():

    """
    Preserve existing users and password hashes on SQLite.
    Add new authentication and triage columns when necessary.
    On PostgreSQL, SQLAlchemy db.create_all() handles fresh schema creation.
    """

    if db.engine.dialect.name != "sqlite":
        logger.info("Skipping SQLite-specific migration on dialect '%s'.", db.engine.dialect.name)
        return

    with db.engine.begin() as connection:

        table_exists = connection.execute(
            text("""
                SELECT name
                FROM sqlite_master
                WHERE type='table' AND name='user'
            """)
        ).fetchone()

        if not table_exists:
            return

        columns = connection.execute(
            text("PRAGMA table_info(user)")
        ).fetchall()

        existing_columns = {
            column[1] for column in columns
        }

        if "full_name" not in existing_columns:

            connection.execute(
                text("""
                    ALTER TABLE user
                    ADD COLUMN full_name VARCHAR(150)
                """)
            )

            print("Added full_name column.", flush=True)

        if "email" not in existing_columns:

            connection.execute(
                text("""
                    ALTER TABLE user
                    ADD COLUMN email VARCHAR(255)
                """)
            )

            print("Added email column.", flush=True)

        if "is_verified" not in existing_columns:

            connection.execute(
                text("""
                    ALTER TABLE user
                    ADD COLUMN is_verified BOOLEAN NOT NULL DEFAULT 1
                """)
            )

            print("Added is_verified column.", flush=True)

        if "created_at" not in existing_columns:

            connection.execute(
                text("""
                    ALTER TABLE user
                    ADD COLUMN created_at DATETIME
                """)
            )

            print("Added created_at column.", flush=True)

        # Preserve access for existing accounts.
        connection.execute(
            text("""
                UPDATE user
                SET is_verified = 1
                WHERE is_verified IS NULL
            """)
        )

        # Prevent duplicate email addresses.
        connection.execute(
            text("""
                CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower
                ON user (lower(email))
                WHERE email IS NOT NULL AND email != ''
            """)
        )

        # Migrate User token_version column for API token revocation.
        user_cols = {
            col[1]
            for col in connection.execute(text("PRAGMA table_info(user)")).fetchall()
        }
        if "token_version" not in user_cols:
            connection.execute(
                text("ALTER TABLE user ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1")
            )

        # Migrate Alert table with triage columns if needed.
        alert_table = connection.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='alert'")
        ).fetchone()
        if alert_table:
            alert_cols = {
                col[1]
                for col in connection.execute(text("PRAGMA table_info(alert)")).fetchall()
            }
            if "status" not in alert_cols:
                connection.execute(
                    text("ALTER TABLE alert ADD COLUMN status VARCHAR(30) NOT NULL DEFAULT 'open'")
                )
            if "notes" not in alert_cols:
                connection.execute(text("ALTER TABLE alert ADD COLUMN notes TEXT"))
            if "user_id" not in alert_cols:
                connection.execute(text("ALTER TABLE alert ADD COLUMN user_id INTEGER"))

    print("Database migration completed.", flush=True)


def initialize_database():

    with app.app_context():

        db.create_all()

        migrate_existing_database()

        admin = User.query.filter_by(
            username="admin"
        ).first()

        configured_admin_pw = (os.getenv("ADMIN_PASSWORD") or "").strip()

        if not admin:

            admin = User(
                full_name="EcoGuard Administrator",
                username="admin",
                email=None,
                password=generate_password_hash(
                    configured_admin_pw or "admin123"
                ),
                is_verified=True,
                token_version=1,
            )

            db.session.add(admin)
            db.session.commit()

            print("Default admin account created.", flush=True)

        elif (
            configured_admin_pw
            and configured_admin_pw != "admin123"
            and check_password_hash(admin.password, "admin123")
        ):
            # Upgrade legacy default password to configured ADMIN_PASSWORD from .env
            admin.password = generate_password_hash(configured_admin_pw)
            admin.token_version = (admin.token_version or 1) + 1
            db.session.commit()
            logger.info("Upgraded default admin password to configured ADMIN_PASSWORD.")

        print("Database initialized successfully.", flush=True)


# ============================================================
# 7. INPUT VALIDATION
# ============================================================

def validate_email(email):

    email = email.strip().lower()

    pattern = (
        r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$"
    )

    return bool(re.match(pattern, email))


def validate_username(username):

    if len(username) < 3 or len(username) > 30:
        return False

    return bool(
        re.fullmatch(
            r"[A-Za-z0-9_.]+",
            username
        )
    )


def validate_password(password):

    if len(password) < 8:
        return False

    if not re.search(r"[A-Za-z]", password):
        return False

    if not re.search(r"[0-9]", password):
        return False

    return True


# ============================================================
# 8. LOGIN DECORATOR
# ============================================================

def login_required(function):

    @wraps(function)
    def wrapper(*args, **kwargs):

        user_id = session.get("user_id")

        if not user_id:

            session.clear()

            flash(
                "Please login to access this page.",
                "warning"
            )

            return redirect(url_for("login"))

        user = db.session.get(User, user_id)

        if not user:

            session.clear()

            flash(
                "Your session is invalid. Please login again.",
                "warning"
            )

            return redirect(url_for("login"))

        if not user.is_verified:

            session.clear()

            flash(
                "Please verify your email before continuing.",
                "warning"
            )

            return redirect(url_for("login"))

        return function(*args, **kwargs)

    return wrapper


# ============================================================
# 9. CSRF ERROR HANDLER
# ============================================================

@app.errorhandler(CSRFError)
def handle_csrf_error(error):

    print("CSRF ERROR:", error.description, flush=True)

    flash(
        "Your form session has expired. Please try again.",
        "warning"
    )

    if request.endpoint == "signup":
        return redirect(url_for("signup"))

    if request.endpoint == "resend_verification":
        return redirect(url_for("resend_verification"))

    if request.endpoint == "forgot_password":
        return redirect(url_for("forgot_password"))

    if request.endpoint == "reset_password":
        return redirect(url_for("forgot_password"))

    return redirect(url_for("login"))


# ============================================================
# 10. RISK PREDICTION
# ============================================================

def predict_risk(ndvi, vegetation_loss, previous_ndvi=None, rainfall=None):

    if ndvi is None or vegetation_loss is None:
        return "UNKNOWN"

    # Rule-based baseline / fallback
    risk = "LOW"

    if ndvi <= 0.30 and vegetation_loss >= 40:
        risk = "HIGH"
    elif ndvi <= 0.50 and vegetation_loss >= 25:
        risk = "MEDIUM"

    if model is not None:
        try:
            import pandas as pd

            expected_features = getattr(model, "n_features_in_", 4)

            if expected_features == 4:
                prev_ndvi_val = previous_ndvi if previous_ndvi is not None else ndvi
                rainfall_val = rainfall if rainfall is not None else 100.0
                features = pd.DataFrame(
                    [[ndvi, prev_ndvi_val, vegetation_loss, rainfall_val]],
                    columns=[
                        "current_ndvi",
                        "previous_ndvi",
                        "vegetation_loss",
                        "rainfall"
                    ]
                )
            else:
                features = [[ndvi, vegetation_loss]]

            prediction = model.predict(features)[0]

            if encoder is not None:
                try:
                    prediction = encoder.inverse_transform(
                        [int(prediction)]
                    )[0]
                except Exception:
                    pass

            prediction = str(prediction).upper()

            if prediction in ["HIGH", "MEDIUM", "LOW"]:
                risk = prediction

        except Exception as error:
            logger.warning("ML prediction failed, using rule fallback: %s", error)

    return risk


# ============================================================
# 11. SIMPLE ANALYSIS EXPLANATIONS
# ============================================================


def simple_explanations(analysis, risk_level="UNKNOWN"):

    current_ndvi = analysis.get("current_ndvi")
    previous_ndvi = analysis.get("previous_ndvi")

    coverage = analysis.get("current_coverage_percent")
    vegetation_loss = analysis.get("vegetation_loss")
    rainfall = analysis.get("rainfall")

    historical_loss = analysis.get("historical_forest_loss") or {}

    explanations = {}

    # NDVI explanation
    if current_ndvi is None:
        explanations["ndvi"] = (
            "NDVI information is unavailable for this period."
        )
    elif current_ndvi >= 0.60:
        explanations["ndvi"] = (
            "The area currently shows a relatively strong "
            "vegetation signal from satellite images."
        )
    elif current_ndvi >= 0.30:
        explanations["ndvi"] = (
            "The area has some vegetation, but improvement "
            "may be needed."
        )
    else:
        explanations["ndvi"] = (
            "The satellite vegetation signal is low. "
            "This area may need further investigation."
        )

    # Green coverage
    if coverage is not None:
        gap = max(0, GREEN_TARGET - coverage)

        explanations["coverage"] = (
            f"Current estimated green coverage is {coverage:.2f}%. "
            f"The EcoGuard project target is {GREEN_TARGET:.0f}%. "
            f"The remaining gap is {gap:.2f} percentage points."
        )
    else:
        explanations["coverage"] = (
            "Green coverage could not be calculated because "
            "satellite data is unavailable."
        )

    # Short-term vegetation change
    if vegetation_loss is None:
        explanations["loss"] = (
            "Short-term vegetation change information is unavailable."
        )
    elif vegetation_loss > 0:
        explanations["loss"] = (
            f"Estimated vegetation area decreased by "
            f"{vegetation_loss:.2f}% compared with the previous "
            f"60-day observation period."
        )
    else:
        explanations["loss"] = (
            "No decrease in estimated vegetation area was detected "
            "in this 60-day comparison."
        )

    # NDVI change
    if current_ndvi is not None and previous_ndvi is not None:

        change = current_ndvi - previous_ndvi

        if change > 0:
            explanations["change"] = (
                "The vegetation index increased compared "
                "with the previous observation period."
            )
        elif change < 0:
            explanations["change"] = (
                "The vegetation index decreased compared "
                "with the previous observation period."
            )
        else:
            explanations["change"] = (
                "The vegetation index remained almost unchanged."
            )
    else:
        explanations["change"] = (
            "There is not enough satellite data to compare "
            "the two periods."
        )

    # Rainfall
    if rainfall is None:
        explanations["rainfall"] = (
            "Rainfall information is unavailable for this period."
        )
    else:
        explanations["rainfall"] = (
            f"Approximately {rainfall:.1f} mm of rainfall was "
            "recorded during the current observation period. "
            "Rainfall is environmental context and does not "
            "directly prove forest loss."
        )

    # Historical forest loss
    historical_hectares = historical_loss.get(
        "total_forest_loss_hectares"
    )

    historical_percent = historical_loss.get(
        "historical_loss_percent"
    )

    recent_hectares = historical_loss.get(
        "recent_5_year_loss_hectares"
    )

    if historical_hectares is not None:

        explanations["historical_loss"] = (
            f"The satellite forest-change dataset detected "
            f"approximately {historical_hectares:,.2f} hectares "
            f"of gross forest-cover loss during "
            f"2001–2025 within the selected area."
        )

        if historical_percent is not None:
            explanations["historical_loss"] += (
                f" This equals approximately "
                f"{historical_percent:.2f}% of the estimated "
                f"baseline forest area."
            )

        if recent_hectares is not None:
            explanations["historical_loss"] += (
                f" The recorded loss during 2021–2025 was "
                f"{recent_hectares:,.2f} hectares."
            )

    else:
        explanations["historical_loss"] = (
            "Historical forest-loss information is unavailable."
        )

    # Risk explanation
    if risk_level == "HIGH":
        explanations["risk"] = (
            "The current project risk rules classify this area "
            "as HIGH. Further field verification is recommended."
        )
    elif risk_level == "MEDIUM":
        explanations["risk"] = (
            "The current project risk rules classify this area "
            "as MEDIUM. Continued monitoring is recommended."
        )
    elif risk_level == "LOW":
        explanations["risk"] = (
            "The current project risk rules classify this area "
            "as LOW based on the available indicators. "
            "LOW does not mean that the area has no historical "
            "forest loss."
        )
    else:
        explanations["risk"] = (
            "Risk could not be classified because the required "
            "satellite information is unavailable."
        )

    return explanations


# ============================================================
# 12. TREE PLANTING ESTIMATION
# ============================================================

def calculate_tree_requirement(analysis):

    coverage = analysis.get("current_coverage_percent")
    total_area = analysis.get("total_area_m2")

    if coverage is None or total_area is None:

        return {
            "coverage_gap": None,
            "minimum_trees": None,
            "target": GREEN_TARGET
        }

    coverage_gap = max(0, GREEN_TARGET - coverage)

    required_area_m2 = total_area * coverage_gap / 100

    required_area_hectare = required_area_m2 / 10000

    minimum_trees = round(
        required_area_hectare * TREES_PER_HECTARE
    )

    return {
        "coverage_gap": round(coverage_gap, 2),
        "minimum_trees": minimum_trees,
        "target": GREEN_TARGET
    }


# ============================================================
# 13. ENVIRONMENTAL EMAIL ALERT
# ============================================================

def send_email_alert(location, risk, ndvi, vegetation_loss):

    alert_email = os.getenv("ALERT_EMAIL")

    if not alert_email:
        return "Not configured"

    body = f"""
ECOGUARD FOREST MONITORING ALERT

Location: {location}

Risk Level: {risk}

Current NDVI: {ndvi}

Estimated Vegetation Loss: {vegetation_loss}

Please investigate this area.

This is an automated EcoGuard notification.
"""

    sent = send_system_email(
        alert_email,
        f"EcoGuard {risk}-RISK Deforestation Alert",
        body
    )

    return "Sent" if sent else "Failed"


# ============================================================
# 14. HEALTH CHECK
# ============================================================

@app.route("/health")
def health():

    return "EcoGuard Server is Working!", 200


# ============================================================
# 15. LOGIN
# ============================================================

@app.route("/", methods=["GET", "POST"])
def login():

    if session.get("user_id"):

        return redirect(url_for("dashboard"))

    if request.method == "GET":

        return render_template("login.html")

    login_value = (
        request.form.get("email_or_username")
        or request.form.get("username")
        or request.form.get("email")
        or ""
    ).strip()

    password = request.form.get("password", "")

    if not login_value or not password:

        flash(
            "Please enter your email/username and password.",
            "danger"
        )

        return redirect(url_for("login"))

    try:

        user = User.query.filter(
            func.lower(User.username) == login_value.lower()
        ).first()

        if not user and "@" in login_value:

            user = User.query.filter(
                func.lower(User.email) == login_value.lower()
            ).first()

        if not user or not check_password_hash(
            user.password,
            password
        ):

            flash(
                "Incorrect email/username or password.",
                "danger"
            )

            return redirect(url_for("login"))

        if not user.is_verified:

            flash(
                "Your email is not verified yet. Please check your inbox.",
                "warning"
            )

            return redirect(url_for("login"))

        # Prevent session fixation.
        session.clear()

        session["user_id"] = user.id
        session["username"] = user.username
        session["full_name"] = user.full_name or user.username

        remember = request.form.get("remember") == "on"

        session.permanent = remember

        flash(
            f"Login successful! Welcome, {user.username}.",
            "success"
        )

        return redirect(url_for("dashboard"))

    except Exception as error:

        db.session.rollback()

        print("LOGIN ERROR:", error, flush=True)

        flash(
            "Something went wrong during login. Please try again.",
            "danger"
        )

        return redirect(url_for("login"))


# ============================================================
# 16. SIGN UP
# ============================================================

@app.route("/signup", methods=["GET", "POST"])
def signup():

    if session.get("user_id"):

        return redirect(url_for("dashboard"))

    if request.method == "GET":

        return render_template("signup.html")

    full_name = request.form.get("full_name", "").strip()
    username = request.form.get("username", "").strip()
    email = request.form.get("email", "").strip().lower()

    password = request.form.get("password", "")
    confirm_password = request.form.get("confirm_password", "")

    if not full_name or not username or not email or not password:

        flash(
            "Please complete all required fields.",
            "danger"
        )

        return redirect(url_for("signup"))

    if len(full_name) > 150:

        flash(
            "Full name is too long.",
            "danger"
        )

        return redirect(url_for("signup"))

    if not validate_username(username):

        flash(
            "Username must be 3-30 characters and may contain letters, numbers, dots and underscores.",
            "danger"
        )

        return redirect(url_for("signup"))

    if not validate_email(email):

        flash(
            "Please enter a valid email address.",
            "danger"
        )

        return redirect(url_for("signup"))

    if not validate_password(password):

        flash(
            "Password must contain at least 8 characters, including letters and numbers.",
            "danger"
        )

        return redirect(url_for("signup"))

    if password != confirm_password:

        flash(
            "Password and confirm password do not match.",
            "danger"
        )

        return redirect(url_for("signup"))

    try:

        existing_username = User.query.filter(
            func.lower(User.username) == username.lower()
        ).first()

        if existing_username:

            flash(
                "This username is already taken.",
                "danger"
            )

            return redirect(url_for("signup"))

        existing_email = User.query.filter(
            func.lower(User.email) == email
        ).first()

        if existing_email:

            flash(
                "An account with this email already exists.",
                "danger"
            )

            return redirect(url_for("signup"))

        new_user = User(
            full_name=full_name,
            username=username,
            email=email,
            password=generate_password_hash(password),
            is_verified=False
        )

        db.session.add(new_user)
        db.session.commit()

        email_sent = send_verification_email(new_user)

        if email_sent:

            flash(
                "Your account has been created. Please check your email to verify your account.",
                "success"
            )

        else:

            flash(
                "Your account was created, but the verification email could not be sent. Please check SMTP configuration and resend verification.",
                "warning"
            )

        return redirect(url_for("login"))

    except Exception as error:

        db.session.rollback()

        print("SIGNUP ERROR:", error, flush=True)

        flash(
            "Registration failed. Please try again.",
            "danger"
        )

        return redirect(url_for("signup"))


# ============================================================
# 17. EMAIL VERIFICATION
# ============================================================

def _frontend_login_redirect(status_param):
    """Redirect to the Next.js frontend /login page when configured for production."""
    if app.config.get("TESTING"):
        return redirect(url_for("login"))
    primary_frontend = (os.getenv("FRONTEND_ORIGIN") or "").split(",")[0].strip().rstrip("/")
    if primary_frontend and not primary_frontend.startswith(("http://127.0.0.1:5000", "http://localhost:5000")):
        return redirect(f"{primary_frontend}/login?verified={status_param}")
    return redirect(url_for("login"))


@app.route("/verify-email/<token>")
def verify_email(token):

    email = verify_email_token(
        token,
        "email-verification",
        TOKEN_MAX_AGE
    )

    if not email:

        flash(
            "This verification link is invalid or expired.",
            "danger"
        )

        return _frontend_login_redirect("invalid")

    user = User.query.filter(
        func.lower(User.email) == email.lower()
    ).first()

    if not user:

        flash(
            "Account not found.",
            "danger"
        )

        return _frontend_login_redirect("invalid")

    if user.is_verified:

        flash(
            "Your email is already verified. Please login.",
            "success"
        )

        return _frontend_login_redirect("already")

    user.is_verified = True

    db.session.commit()

    flash(
        "Email verified successfully! You can now login.",
        "success"
    )

    return _frontend_login_redirect("1")


# ============================================================
# 18. RESEND VERIFICATION EMAIL
# ============================================================

@app.route("/resend-verification", methods=["GET", "POST"])
def resend_verification():

    if request.method == "GET":

        return render_template("resend_verification.html")

    email = request.form.get("email", "").strip().lower()

    if not validate_email(email):

        flash(
            "Please enter a valid email address.",
            "danger"
        )

        return redirect(url_for("resend_verification"))

    user = User.query.filter(
        func.lower(User.email) == email
    ).first()

    if user and not user.is_verified:

        if send_verification_email(user):

            flash(
                "A new verification link has been sent.",
                "success"
            )

        else:

            flash(
                "Email could not be sent. Please check SMTP configuration.",
                "danger"
            )

    else:

        flash(
            "If an unverified account exists for that email, a verification link will be sent.",
            "info"
        )

    return redirect(url_for("login"))


# ============================================================
# 19. FORGOT PASSWORD
# ============================================================

@app.route("/forgot-password", methods=["GET", "POST"])
def forgot_password():

    if request.method == "GET":

        return render_template("forgot_password.html")

    email = request.form.get("email", "").strip().lower()

    if not validate_email(email):

        flash(
            "Please enter a valid email address.",
            "danger"
        )

        return redirect(url_for("forgot_password"))

    user = User.query.filter(
        func.lower(User.email) == email
    ).first()

    if user and user.is_verified:

        if not send_password_reset_email(user):

            print(
                "Password reset email could not be sent.",
                flush=True
            )

    flash(
        "If a verified account exists with this email, a password reset link will be sent.",
        "info"
    )

    return redirect(url_for("login"))


# ============================================================
# 20. RESET PASSWORD
# ============================================================

@app.route("/reset-password/<token>", methods=["GET", "POST"])
def reset_password(token):

    email = verify_email_token(
        token,
        "password-reset",
        RESET_TOKEN_MAX_AGE
    )

    if not email:

        flash(
            "This password reset link is invalid or expired.",
            "danger"
        )

        return redirect(url_for("forgot_password"))

    user = User.query.filter(
        func.lower(User.email) == email.lower()
    ).first()

    if not user:

        flash(
            "Account not found.",
            "danger"
        )

        return redirect(url_for("login"))

    if request.method == "GET":

        return render_template(
            "reset_password.html",
            token=token
        )

    password = request.form.get("password", "")
    confirm_password = request.form.get("confirm_password", "")

    if not validate_password(password):

        flash(
            "Password must contain at least 8 characters, including letters and numbers.",
            "danger"
        )

        return render_template(
            "reset_password.html",
            token=token
        )

    if password != confirm_password:

        flash(
            "Passwords do not match.",
            "danger"
        )

        return render_template(
            "reset_password.html",
            token=token
        )

    user.password = generate_password_hash(password)
    user.token_version = (user.token_version or 1) + 1

    db.session.commit()

    flash(
        "Your password has been changed successfully. Please login.",
        "success"
    )

    return redirect(url_for("login"))


# ============================================================
# 21. LOGOUT
# ============================================================

@app.route("/logout", methods=["POST"])
@login_required
def logout():

    session.clear()

    response = redirect(url_for("login"))

    response.delete_cookie(
        app.config.get("SESSION_COOKIE_NAME", "session")
    )

    flash(
        "You have been logged out successfully.",
        "info"
    )

    return response


# ============================================================
# 22. DASHBOARD
# ============================================================

@app.route("/dashboard")
@login_required
def dashboard():

    try:

        alerts = Alert.query.order_by(
            Alert.created_at.desc()
        ).limit(10).all()

        total_alerts = Alert.query.count()

        high_risk_count = Alert.query.filter_by(
            risk_level="HIGH"
        ).count()

        medium_risk_count = Alert.query.filter_by(
            risk_level="MEDIUM"
        ).count()

        low_risk_count = Alert.query.filter_by(
            risk_level="LOW"
        ).count()

        total_feedback = Feedback.query.count()

        return render_template(
            "dashboard.html",
            username=session.get("username"),
            full_name=session.get("full_name"),
            alerts=alerts,
            total_alerts=total_alerts,
            high_risk_count=high_risk_count,
            medium_risk_count=medium_risk_count,
            low_risk_count=low_risk_count,
            total_feedback=total_feedback,
            green_target=GREEN_TARGET
        )

    except Exception as error:

        print("DASHBOARD ERROR:", error, flush=True)

        return "Dashboard error: " + str(error), 500

# ============================================================
# SATELLITE MONITORING - SEPARATE PAGE
# ============================================================

@app.route("/satellite-monitoring")
@login_required
def satellite_monitoring():

    return render_template(
        "satellite_monitoring.html",
        analysis=None,
        location=None,
        location_data=None,
        tree_data=None,
        green_target=GREEN_TARGET,
        trees_per_hectare=TREES_PER_HECTARE
    )


@app.route("/satellite-monitoring/analyze", methods=["POST"])
@login_required
def satellite_monitoring_analyze():

    place_name = request.form.get("location", "").strip()

    if not place_name:
        flash("Please select a location.", "warning")
        return redirect(url_for("satellite_monitoring"))

    try:
        location_data = get_location(place_name)

        if not location_data:
            flash("Location not found. Please choose a valid suggestion.", "danger")
            return redirect(url_for("satellite_monitoring"))

        bounding_box = location_data.get("boundingbox")

        if not bounding_box:
            flash("Location boundary is unavailable.", "danger")
            return redirect(url_for("satellite_monitoring"))

        analysis_data = analyze_area(bounding_box)

        if not analysis_data:
            flash("Satellite analysis could not be completed.", "danger")
            return redirect(url_for("satellite_monitoring"))

        tree_data = calculate_tree_requirement(analysis_data)

        return render_template(
            "satellite_monitoring.html",
            analysis=analysis_data,
            location=location_data["name"],
            location_data=location_data,
            tree_data=tree_data,
            green_target=GREEN_TARGET,
            trees_per_hectare=TREES_PER_HECTARE
        )

    except Exception as error:
        print("SATELLITE MONITORING ERROR:", repr(error), flush=True)
        flash("Satellite analysis failed. Please check the server terminal.", "danger")
        return redirect(url_for("satellite_monitoring"))


@app.route("/green-coverage", methods=["GET", "POST"])
@login_required
def green_coverage():

    analysis = None
    location = None
    location_data = None

    if request.method == "POST":

        place_name = request.form.get("location", "").strip()

        if not place_name:
            flash("Please enter a location.", "warning")
            return redirect(url_for("green_coverage"))

        try:
            location_data = get_location(place_name)

            if not location_data:
                raise ValueError("Location not found.")

            bounding_box = (
                location_data.get("boundingbox")
                or location_data.get("bounding_box")
            )

            if not bounding_box:
                raise ValueError("Location boundary not found.")

            analysis = analyze_green_coverage(bounding_box)

            location = (
                location_data.get("name")
                or place_name
            )

        except Exception as error:
            print("GREEN COVERAGE ERROR:", error, flush=True)
            flash("Green Coverage Error: " + str(error), "danger")
            return redirect(url_for("green_coverage"))

    return render_template(
        "green_coverage.html",
        analysis=analysis,
        location=location,
        location_data=location_data,
        green_target=GREEN_TARGET
    )


def _escape_pdf_text(text_value):
    sanitized = str(text_value).encode("latin-1", "replace").decode("latin-1")
    return sanitized.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _build_simple_pdf(title, lines):
    """Build a minimal single-page PDF document without external dependencies."""
    content_commands = [
        "BT",
        "/F1 16 Tf",
        "50 760 Td",
        f"({_escape_pdf_text(title)}) Tj",
        "/F1 11 Tf",
        "0 -28 Td",
    ]

    for line in lines:
        content_commands.append(f"({_escape_pdf_text(line)}) Tj")
        content_commands.append("0 -18 Td")

    content_commands.append("ET")
    stream_bytes = "\n".join(content_commands).encode("latin-1")

    objects = [
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
        b"4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
        (
            f"5 0 obj\n<< /Length {len(stream_bytes)} >>\nstream\n".encode("latin-1")
            + stream_bytes
            + b"\nendstream\nendobj\n"
        ),
    ]

    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for obj in objects:
        offsets.append(len(pdf))
        pdf.extend(obj)

    xref_offset = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("latin-1"))
    pdf.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode("latin-1"))

    pdf.extend(
        (
            f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref_offset}\n%%EOF\n"
        ).encode("latin-1")
    )
    return bytes(pdf)


@app.route("/green-coverage/pdf", methods=["POST"])
@login_required
def green_coverage_pdf():
    location = request.form.get("location", "Unknown Location").strip() or "Unknown Location"
    lines = [
        f"Generated (UTC): {utc_now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"Location: {location}",
        "",
        f"Green Coverage (WorldCover): {request.form.get('green_coverage', 'N/A')}%",
        f"NDVI Vegetation Coverage: {request.form.get('ndvi_coverage', 'N/A')}%",
        f"Average NDVI: {request.form.get('average_ndvi', 'N/A')}",
        f"Total Area: {request.form.get('total_area', 'N/A')} hectares",
        f"Green Area: {request.form.get('green_area', 'N/A')} hectares",
        f"EcoGuard Target: {request.form.get('target', GREEN_TARGET)}%",
        f"NDVI Change (YoY): {request.form.get('ndvi_change', 'N/A')}",
        f"Coverage Change (YoY): {request.form.get('coverage_change', 'N/A')}%",
    ]

    pdf_bytes = _build_simple_pdf("EcoGuard - Green Coverage Report", lines)
    safe_name = re.sub(r"[^A-Za-z0-9_-]+", "_", location).strip("_") or "report"

    return send_file(
        io.BytesIO(pdf_bytes),
        mimetype="application/pdf",
        as_attachment=True,
        download_name=f"ecoguard_green_coverage_{safe_name[:40]}.pdf",
    )

# ============================================================
# 23. LOCATION AUTOCOMPLETE
# ============================================================

@app.route("/suggest")
@login_required
def suggest():

    search_text = request.args.get("q", "").strip()

    if len(search_text) < 2:

        return jsonify([])

    try:

        results = suggest_locations(
            search_text,
            limit=7
        )

        return jsonify(results)

    except Exception as error:

        print("Suggestion error:", error, flush=True)

        return jsonify([])


# ============================================================
# 24. SATELLITE ANALYSIS
# ============================================================

@app.route("/analyze", methods=["POST"])
@login_required
def analyze():

    place_name = request.form.get("location", "").strip()

    if not place_name:

        flash(
            "Please enter a location.",
            "warning"
        )

        return redirect(url_for("dashboard"))

    try:

        print(
            "Searching location:",
            place_name,
            flush=True
        )

        location_data = get_location(place_name)

        if not location_data:

            flash(
                "Location not found. Please select a valid suggestion.",
                "danger"
            )

            return redirect(url_for("dashboard"))

        bounding_box = (
            location_data.get("boundingbox")
            or location_data.get("bounding_box")
        )

        if not bounding_box:

            flash(
                "Location boundary unavailable.",
                "danger"
            )

            return redirect(url_for("dashboard"))

        print(
            "Starting satellite analysis.",
            flush=True
        )

        analysis_data = analyze_area(bounding_box)

        if not analysis_data:

            flash(
                "Satellite analysis failed.",
                "danger"
            )

            return redirect(url_for("dashboard"))

        ndvi = analysis_data.get("current_ndvi")
        previous_ndvi = analysis_data.get("previous_ndvi")
        vegetation_loss = analysis_data.get("vegetation_loss")
        rainfall = analysis_data.get("rainfall")

        risk_level = predict_risk(
            ndvi,
            vegetation_loss,
            previous_ndvi=previous_ndvi,
            rainfall=rainfall
        )

        explanations = simple_explanations(
            analysis_data,
            risk_level
        )

        tree_data = calculate_tree_requirement(
            analysis_data
        )

        email_status = "Not required"

        if risk_level in ["HIGH", "MEDIUM"]:

            email_status = send_email_alert(
                place_name,
                risk_level,
                ndvi,
                vegetation_loss
            )

            new_alert = Alert(
                location=place_name,
                latitude=location_data.get("latitude"),
                longitude=location_data.get("longitude"),
                risk_level=risk_level,
                ndvi=ndvi,
                vegetation_loss=vegetation_loss,
                email_status=email_status,
                sms_status="Not configured"
            )

            db.session.add(new_alert)
            db.session.commit()

        return render_template(
            "prediction.html",
            location=location_data,
            location_data=location_data,
            analysis=analysis_data,
            stats=analysis_data,
            risk_level=risk_level,
            risk=risk_level,
            explanations=explanations,
            tree_data=tree_data,
            trees_needed=tree_data.get("minimum_trees"),
            coverage_gap=tree_data.get("coverage_gap"),
            green_target=GREEN_TARGET,
            trees_per_hectare=TREES_PER_HECTARE,
            email_status=email_status
        )

    except Exception as error:

        db.session.rollback()

        print(
            "ANALYSIS ERROR:",
            error,
            flush=True
        )

        flash(
            "Analysis failed: " + str(error),
            "danger"
        )

        return redirect(url_for("dashboard"))


# ============================================================
# 25. FEEDBACK
# ============================================================

@app.route("/feedback", methods=["POST"])
@login_required
def feedback():

    try:

        rating = int(
            request.form.get("rating", 5)
        )

        category = request.form.get(
            "category",
            "General"
        ).strip()

        message = request.form.get(
            "message",
            ""
        ).strip()

        if rating < 1 or rating > 5:

            flash(
                "Invalid rating.",
                "danger"
            )

            return redirect(url_for("dashboard"))

        if not message:

            flash(
                "Please write your feedback.",
                "warning"
            )

            return redirect(url_for("dashboard"))

        new_feedback = Feedback(
            rating=rating,
            category=category,
            message=message
        )

        db.session.add(new_feedback)
        db.session.commit()

        flash(
            "Thank you! Your feedback has been submitted.",
            "success"
        )

    except Exception as error:

        db.session.rollback()

        print(
            "FEEDBACK ERROR:",
            error,
            flush=True
        )

        flash(
            "Feedback could not be submitted.",
            "danger"
        )

    return redirect(url_for("dashboard"))


# ============================================================
# 26. SECURITY HEADERS, JSON API ERRORS & BLUEPRINT STARTUP
# ============================================================

@app.after_request
def apply_security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault(
        "Permissions-Policy", "geolocation=(), microphone=(), camera=()"
    )
    if request.is_secure or app.config.get("SESSION_COOKIE_SECURE"):
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
        )
    response.headers["Server"] = "EcoGuard"
    return response


def _json_api_error(status_code, default_message):
    def _handler(error):
        if request.path.startswith("/api/"):
            return jsonify({"error": default_message}), status_code
        return error
    return _handler


for _code, _msg in (
    (400, "Bad request."),
    (401, "Authentication required."),
    (403, "Forbidden."),
    (404, "Endpoint not found."),
    (405, "Method not allowed."),
    (429, "Rate limit exceeded."),
    (500, "Internal server error."),
):
    app.register_error_handler(_code, _json_api_error(_code, _msg))

import sys
from api_v1 import api_v1, bind_app_module  # noqa: E402

bind_app_module(sys.modules[__name__])
csrf.exempt(api_v1)
app.register_blueprint(api_v1)

if os.getenv("ECOGUARD_SKIP_INIT_DB", "").lower() != "true":
    initialize_database()


# ============================================================
# 27. RUN APPLICATION
# ============================================================

if __name__ == "__main__":

    print(
        "Starting EcoGuard server...",
        flush=True
    )

    debug_mode = os.getenv("FLASK_DEBUG", "false").lower() == "true"
    app.run(
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "5000")),
        debug=debug_mode,
        use_reloader=False,
        threaded=True
    )
