import os
import sys

# Ensure EcoGuard directory is importable and prevent touching the production DB
ECOGUARD_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ECOGUARD_DIR not in sys.path:
    sys.path.insert(0, ECOGUARD_DIR)

os.environ["ECOGUARD_SKIP_INIT_DB"] = "true"
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["SECRET_KEY"] = "test-secret-key-for-pytest-only"

import pytest
from werkzeug.security import generate_password_hash

import app as ecoguard_app


@pytest.fixture()
def app_instance():
    app = ecoguard_app.app
    app.config.update(
        TESTING=True,
        WTF_CSRF_ENABLED=False,
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
    )

    with app.app_context():
        ecoguard_app.db.drop_all()
        ecoguard_app.db.create_all()

        verified_user = ecoguard_app.User(
            full_name="Test Researcher",
            username="tester",
            email="tester@example.com",
            password=generate_password_hash("StrongPass123"),
            is_verified=True,
        )
        ecoguard_app.db.session.add(verified_user)
        ecoguard_app.db.session.commit()

        yield app

        ecoguard_app.db.session.remove()
        ecoguard_app.db.drop_all()


@pytest.fixture()
def client(app_instance):
    return app_instance.test_client()


@pytest.fixture()
def logged_in_client(client):
    response = client.post(
        "/",
        data={"email_or_username": "tester", "password": "StrongPass123"},
        follow_redirects=False,
    )
    assert response.status_code == 302
    return client
