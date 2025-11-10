import re 
import json 

filename = "../data/30node-clusters/25.json"
output_filename = filename.replace(".json", "_structured.json")

# --- FILE READING & INITIAL CLEANUP ---

with open(filename, 'r') as file: 
    raw_content = file.read()

# Handle double-encoded content and unescape
if raw_content.startswith('"') and raw_content.endswith('"'):
    content_string = raw_content.strip().strip('"').replace('\\n', '\n')
    content_string = content_string.replace('\\"', '"')
else: 
    content_string = raw_content

# --- AGGRESSIVE JSON REPAIR ---

# A. Extract the clean 'params' object string
clean_params_match = re.search(r'"params":\s*({.*?})', content_string, re.DOTALL)
if not clean_params_match:
    print(f"[Warning] File {filename} is missing a valid 'params' object.")
    params_object_str = "{}" # Fallback
else:
    params_object_str = clean_params_match.group(1)

# B. Extract ALL strictly valid data rows
valid_rows = re.findall(
    r'\[\s*(?:\d+\s*,\s*){5,6}\d+\s*\]',  # match 4 or 5 numbers inside brackets
    content_string,
    flags=re.DOTALL
)


if not valid_rows:
    print(f"[Warning] File {filename} contains no valid data rows to process.")
    exit()

# C. Reconstruct the clean JSON string (FIXED: Removed extra closing '}')
clean_data_array = ',\n'.join(valid_rows)

content_string = (
    '{\n"params":' + params_object_str + 
    ',\n"data": [\n' + 
    clean_data_array + 
    '\n]\n}\n}' # Correctly closes the "data" array and the main object
)

try:
    # Attempt to load the reconstructed JSON
    content = json.loads(content_string)
    content = content["params"]
    print(content.keys())
except json.JSONDecodeError as e:
    print(f"[Error] Failed to decode JSON in {filename} after repair: {e}")
    exit()


# --- DATA RESTRUCTURING TO DESIRED FORMAT ---

# 1. Extract the raw data rows
data_rows = content.get('data', [])

# 2. Convert raw string rows (first 4 columns) to integers
# The columns are: 0: timestamp, 1: state (x), 2: vstate (z), 3: vartheta (theta)
data_cols = [list(map(int, row[:4])) for row in data_rows]

# 3. Transpose the data: rows -> columns
# This converts [(t1, x1, z1, theta1), ...] into [(t1, t2, ...), (x1, x2, ...), ...]
transposed_data = list(zip(*data_cols))

if len(transposed_data) < 4:
    print("Not enough columns found in the data.")
    exit()

# 4. Create the final restructured data object
restructured_data_obj = {
    "timestamp": list(transposed_data[0]),
    "state": list(transposed_data[1]),
    "vstate": list(transposed_data[2]),
    "vartheta": list(transposed_data[3])
}

# 5. Assemble the final output dictionary
final_output = {
    "data": restructured_data_obj
}

# --- WRITE NEW JSON FILE ---

with open(output_filename, 'w') as outfile:
    # Use indent=2 for a readable, pretty-printed file
    json.dump(final_output, outfile, indent=2)

