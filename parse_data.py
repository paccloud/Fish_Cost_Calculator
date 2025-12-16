import re
import json

def clean_ocr(text):
    text = text.replace("O/H", "D/H").replace("0/", "D/").replace("Ofi", "Off").replace("SI B", "S/B")
    return text

def parse_pdf_content(filepath):
    with open(filepath, 'r') as f:
        lines = f.readlines()

    fish_data = {}
    
    # We'll use a manually curated list of major species to look for unique headers
    # and then try to capture following lines.
    # Note: Because of 2-column layout, we might capture data from the other column.
    # However, if we look for the specific lines for "Cod", we might find them.
    
    # Let's try to extract all "Product ... Avg ... Range" lines
    # and just put them in a big list, then we can categorize them?
    # No, product names are generic ("Round", "Fillet"). Context is needed.
    
    # Regex for a data entry: (Description) (Avg) (Range)
    # (?P<desc>[A-Za-z0-9 /\(\)-]+?) (?P<avg>\d{1,3}) (?P<range>\d+-\d+)?
    
    data_pattern = re.compile(r'(?P<desc>[A-Za-z0-9 /\(\)-]+?)\s+(?P<avg>\d{1,3})\s+(?P<range>\d+-\d+)?')
    
    # Let's try to iterate and see if we can identify headers.
    # Headers usually don't match the data pattern (no number).
    
    # We will assume that if we find a line with "SpeciesName ... SpeciesName", it sets left/right context.
    # If "SpeciesName ... <data>", it sets left, and other is data?
    
    # Improved heuristic:
    # 1. Identify text chunks.
    # 2. Assign to columns.
    
    # List of known species matching the user's HTML and likely PDF content
    species_list = [
        "Abalone", "Capelin", "Clams", "Cockles", "Cod, Pacific", "Crab", "Dungeness", "King", "Tanner",
        "Flounders", "Arrowtooth", "Starry", "Halibut, Pacific", "Herring, Pacific", "Lingcod",
        "Mackerel", "Mussels", "Octopus", "Oysters", "Perch", "Pollock", "Rockfish", "Sablefish",
        "Salmon", "Pink", "Chum", "Sockeye", "Coho", "Chinook", "Scallops", "Shark", "Shrimp",
        "Sole", "Squid", "Tuna", "Turbot"
    ]
    
    current_left = "Unknown"
    current_right = "Unknown"
    
    for line in lines:
        line = clean_ocr(line.strip())
        if not line or "--- Page" in line or "Recoveries" in line:
            continue
            
        # Check if line contains species names
        # Very rough check
        found_species = []
        for s in species_list:
            if s in line:
                found_species.append(s)
        
        # If we found species, it might be a header line
        # But "Pink" is a species and also a color/shrimp. "Pink Shrimp".
        # "Cod, Pacific" is distinct.
        
        # Let's try to split the line into two halves based on a wide gap (if preserved)
        # or just try to regex two data items.
        
        # Aggressive Regex for 2-column data
        # "Item1 99 88-99 Item2 55 44-66"
        # Item cannot start with a number.
        two_col_match = re.search(r'^(?P<d1>.+?)\s+(?P<a1>\d+)\s+(?P<r1>\d+-\d+)?\s+(?P<d2>.+?)\s+(?P<a2>\d+)\s+(?P<r2>\d+-\d+)?$', line)
        
        if two_col_match:
            # Found 2 columns of data
            if current_left not in fish_data: fish_data[current_left] = {}
            if current_right not in fish_data: fish_data[current_right] = {}
            
            d1, a1, r1 = two_col_match.group('d1'), two_col_match.group('a1'), two_col_match.group('r1')
            d2, a2, r2 = two_col_match.group('d2'), two_col_match.group('a2'), two_col_match.group('r2')
            
            fish_data[current_left][d1.strip()] = {"yield": a1, "range": r1}
            fish_data[current_right][d2.strip()] = {"yield": a2, "range": r2}
            continue
            
        # If not 2-column data, maybe 1-column data?
        # But which column?
        # If line is short, maybe it belongs to left?
        # Or maybe it's a header?
        
        # If line looks like "Name ... Name", it resets headers.
        # Heuristic: if we found 2 species names in the line, update headers.
        if len(found_species) >= 2:
            # Likely "Species1 ... Species2"
            # We need to determine which is which. Assumed order left-right matching position?
            # Regex to find them?
            # Just take the first two found as Left/Right order in string (found_species order depends on list iteration? No, scan line).
            
            # Find indices
            matches = []
            for s in species_list:
                for m in re.finditer(re.escape(s), line):
                    matches.append((m.start(), s))
            matches.sort()
            
            if len(matches) >= 2:
                # Update headers
                current_left = matches[0][1]
                current_right = matches[1][1]
                
                # "Salmon ... Pink" -> Main Header "Salmon", Sub Header "Pink"?
                # In PDF: "Salmon" (section) "Pink" (subsection).
                # Page 9: "Salmon" (Left col top). "Pink" (Left col sub).
                # This suggests hierarchy. 
                # Our simple left/right logic might fail for hierarchy.
                
                # However, for "Cod, Pacific", it's distinct.
                continue
                
        # One col match?
        one_col_match = re.search(r'^(?P<d1>.+?)\s+(?P<a1>\d+)\s+(?P<r1>\d+-\d+)?$', line)
        if one_col_match:
            # Belongs to... ?
            # If "Salmon" is current_left, add to it?
            # Hard to know if it's left or right column data without x-pos.
            # But "Recoveries..." PDF usually fills Left then Right? 
            # Or aligns specific items?
            # In the snippet 29, line 200: "Whole... Round..." (filled both).
            # Line 204: "SIB Fillets... " (Left only, right empty?) -> NO, line 204 ends with "33".
            # Then line 205: "Blackcod... 38"
            
            # Risk: We assign data to wrong fish.
            # Mitigation: Only capture high confidence lines.
            
            # For the purpose of the calculator, we specifically need:
            # Salmon (Pink, Sockeye, Coho, Chinook), Cod, Tuna, Rockfish.
            
            if current_left != "Unknown" and len(line) < 40: # Short line -> likely Left?
                 d1, a1, r1 = one_col_match.group('d1'), one_col_match.group('a1'), one_col_match.group('r1')
                 if current_left not in fish_data: fish_data[current_left] = {}
                 fish_data[current_left][d1.strip()] = {"yield": a1, "range": r1}
    
    # Output to JS
    js_content = "const FISH_DATA = " + json.dumps(fish_data, indent=4) + ";"
    with open('data/fish_data.js', 'w') as f:
        f.write(js_content)
    
    print("Parsed data written to data/fish_data.js")

if __name__ == "__main__":
    parse_pdf_content("pdf_content.txt")
