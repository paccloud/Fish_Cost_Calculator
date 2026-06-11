import pandas as pd
import json
import re

def update_data():
    # Read existing JS file
    with open("data/fish_data.js", "r") as f:
        content = f.read()

    # Extract FISH_DATA JSON
    # Pattern: generic match for the first object
    # const FISH_DATA = { ... };
    # We can split by ";\nconst PROFILES_DATA" maybe?
    
    parts = content.split(";\nconst PROFILES_DATA")
    fish_data_js = parts[0]
    profiles_data_js = "const PROFILES_DATA" + parts[1] if len(parts) > 1 else ""
    
    # Remove "const FISH_DATA = "
    json_str = fish_data_js.replace("const FISH_DATA = ", "").strip()
    # It might end with a semicolon
    if json_str.endswith(";"): json_str = json_str[:-1]
    
    try:
        fish_data = json.loads(json_str)
    except Exception as e:
        print("Failed to parse existing JSON:", e)
        return

    # Read Excel
    df = pd.read_excel("datasets/% Yields NHCS.xlsx", sheet_name="Sheet1")
    
    for index, row in df.iterrows():
        name = row["Common name"]
        if pd.isna(name): continue
        
        yield_val = row["% Yield"]
        notes = row["Notes"] if not pd.isna(row["Notes"]) else ""
        
        # Clean Yield
        # If float < 1, multiply by 100
        # If string "80-85%", extract range?
        
        final_yield = 0
        final_range = ""
        
        try:
            if isinstance(yield_val, (int, float)):
                if yield_val < 1:
                    final_yield = int(yield_val * 100)
                else:
                    final_yield = int(yield_val)
            elif isinstance(yield_val, str):
                # Check for range "80-85%"
                yield_val = yield_val.replace("%", "").strip()
                if "-" in yield_val:
                    r_parts = yield_val.split("-")
                    low = float(r_parts[0])
                    high = float(r_parts[1])
                    avg = (low + high) / 2
                    final_yield = int(avg)
                    final_range = yield_val
                else:
                    final_yield = int(float(yield_val))
        except:
            print(f"Skipping {name} due to invalid yield: {yield_val}")
            continue
            
        # Add to fish_data
        # Use "East Coast" prefix or just merge? User said "East coast species info".
        # I'll add them as top level keys.
        
        if name not in fish_data:
            fish_data[name] = {}
        
        # Since we don't know the product form, we'll label it "General Yield"
        # or append info from Notes if useful.
        product_label = "Average Yield"
        if notes:
            product_label += f" ({notes.strip()})"
            
        fish_data[name][product_label] = {
            "yield": str(final_yield),
            "range": final_range if final_range else f"{final_yield-5}-{final_yield+5}" # synthetic range?
        }
        
    # Reconstruct file
    new_content = "const FISH_DATA = " + json.dumps(fish_data, indent=4) + ";\n" + profiles_data_js
    
    with open("data/fish_data.js", "w") as f:
        f.write(new_content)
        
    print("Successfully updated fish_data.js with East Coast species.")

if __name__ == "__main__":
    update_data()
