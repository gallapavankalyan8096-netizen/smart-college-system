from sklearn.tree import DecisionTreeClassifier
import numpy as np

# marks, attendance -> 0 Good, 1 Average, 2 At Risk
X = np.array([
    [92, 96], [88, 91], [83, 86], [78, 82], [72, 80], [65, 73], [58, 66]
])
y = np.array([0, 0, 1, 1, 1, 2, 2])

model = DecisionTreeClassifier(max_depth=3, random_state=42)
model.fit(X, y)

labels = {0: "Good", 1: "Average", 2: "At Risk"}

def predict_risk(marks: float, attendance: float) -> str:
    pred = model.predict(np.array([[marks, attendance]]))[0]
    return labels[int(pred)]

if __name__ == "__main__":
    print("Sample Prediction:", predict_risk(74, 79))
