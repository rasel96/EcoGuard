# =========================================================
# ECOGUARD AI MODEL TRAINING
# =========================================================

import numpy as np
import pandas as pd
import joblib

from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report


# =========================================================
# 1. CREATE TRAINING DATA
# =========================================================

np.random.seed(42)


data = []


# ---------------------------------------------------------
# LOW RISK DATA
# ---------------------------------------------------------

for i in range(300):

    current_ndvi = np.random.uniform(
        0.45,
        0.85
    )

    previous_ndvi = np.random.uniform(
        0.45,
        0.85
    )

    vegetation_loss = np.random.uniform(
        0,
        10
    )

    rainfall = np.random.uniform(
        50,
        300
    )

    data.append([

        current_ndvi,
        previous_ndvi,
        vegetation_loss,
        rainfall,
        "LOW"

    ])


# ---------------------------------------------------------
# MEDIUM RISK DATA
# ---------------------------------------------------------

for i in range(300):

    current_ndvi = np.random.uniform(
        0.30,
        0.55
    )

    previous_ndvi = np.random.uniform(
        0.40,
        0.70
    )

    vegetation_loss = np.random.uniform(
        10,
        30
    )

    rainfall = np.random.uniform(
        20,
        200
    )

    data.append([

        current_ndvi,
        previous_ndvi,
        vegetation_loss,
        rainfall,
        "MEDIUM"

    ])


# ---------------------------------------------------------
# HIGH RISK DATA
# ---------------------------------------------------------

for i in range(300):

    current_ndvi = np.random.uniform(
        0.05,
        0.35
    )

    previous_ndvi = np.random.uniform(
        0.30,
        0.70
    )

    vegetation_loss = np.random.uniform(
        25,
        80
    )

    rainfall = np.random.uniform(
        0,
        150
    )

    data.append([

        current_ndvi,
        previous_ndvi,
        vegetation_loss,
        rainfall,
        "HIGH"

    ])


# =========================================================
# 2. CREATE DATAFRAME
# =========================================================

df = pd.DataFrame(

    data,

    columns=[

        "current_ndvi",
        "previous_ndvi",
        "vegetation_loss",
        "rainfall",
        "risk"

    ]

)


print()
print(
    "Training dataset created."
)

print(
    "Total samples:",
    len(df)
)

print()
print(
    df.head()
)

print()
print(
    df["risk"].value_counts()
)


# =========================================================
# 3. FEATURES AND TARGET
# =========================================================

X = df[

    [
        "current_ndvi",
        "previous_ndvi",
        "vegetation_loss",
        "rainfall"
    ]

]


y = df["risk"]


# =========================================================
# 4. ENCODE TARGET
# =========================================================

encoder = LabelEncoder()

y_encoded = encoder.fit_transform(
    y
)


print()
print(
    "Risk classes:",
    encoder.classes_
)


# =========================================================
# 5. TRAIN TEST SPLIT
# =========================================================

X_train, X_test, y_train, y_test = train_test_split(

    X,

    y_encoded,

    test_size=0.20,

    random_state=42,

    stratify=y_encoded

)


# =========================================================
# 6. RANDOM FOREST MODEL
# =========================================================

model = RandomForestClassifier(

    n_estimators=200,

    max_depth=12,

    random_state=42

)


# =========================================================
# 7. TRAIN
# =========================================================

print()
print(
    "Training AI model..."
)

model.fit(

    X_train,

    y_train

)


print(
    "Training completed."
)


# =========================================================
# 8. TEST MODEL
# =========================================================

y_pred = model.predict(
    X_test
)


accuracy = accuracy_score(

    y_test,

    y_pred

)


print()
print(
    "Model Accuracy:",
    round(
        accuracy * 100,
        2
    ),
    "%"
)


print()
print(
    "Classification Report:"
)

print(

    classification_report(

        y_test,

        y_pred,

        target_names=encoder.classes_

    )

)


# =========================================================
# 9. SAVE MODEL
# =========================================================

joblib.dump(

    model,

    "model.pkl"

)


joblib.dump(

    encoder,

    "encoder.pkl"

)


print()
print(
    "=========================================="
)

print(
    "MODEL SAVED SUCCESSFULLY"
)

print(
    "=========================================="
)

print(
    "model.pkl created"
)

print(
    "encoder.pkl created"
)

print()