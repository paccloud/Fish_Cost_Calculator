import pandas as pd

try:
    xl = pd.ExcelFile("datasets/% Yields NHCS.xlsx")
    print("Sheet names:", xl.sheet_names)
    for sheet in xl.sheet_names:
        print(f"--- {sheet} ---")
        df = pd.read_excel("datasets/% Yields NHCS.xlsx", sheet_name=sheet)
        print(df.head().to_string())
except Exception as e:
    print(e)
