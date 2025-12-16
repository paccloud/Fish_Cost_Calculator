import re
import json

def parse_line(line):
    # Try to split line into two columns
    # Pattern: End of col 1 is usually a number or %?
    # Data line pattern: [Desc] [Avg] [Range]? [Desc] [Avg] [Range]?
    
    # Heuristic: Split based on structure
    # Look for "Number [A-Z]" indicating start of second column description?
    # Or "Range [A-Z]"
    
    # Common OCR issues: "O/H" -> "D/H", "SI B" -> "S/B", "0/" -> "D/"
    line = line.replace("O/H", "D/H").replace("0/", "D/").replace("Ofi", "Off").replace("SI B", "S/B")
    
    # Regex to find potential column split in data lines
    # Look for: (Number or Range) (Space) (Text)
    # Be careful: "40-45 Round" -> Split at space
    # "42 40-45" -> This is one column data
    
    # Let's try to match all numbers
    # If we find a sequence: Text Num (Range) Text Num (Range), it's 2 cols
    # If Text Num (Range), it's 1 col (could be left or right? hard to say without alignment)
    
    # Ideally we'd use index/position but we don't have it.
    # We'll assume if we see "Text... Num... Text... Num...", it's 2 cols.
    
    # Regex for a data chunk:
    # (?P<desc>.+?) (?P<avg>\d+(?:\.\d+)?) (?P<range>\d+-\d+)?
    # But description can contain spaces.
    
    pass

def process_file(filepath):
    with open(filepath, 'r') as f:
        lines = f.readlines()

    fish_data = {}
    current_species_left = None
    current_species_right = None
    
    # Regex to detect species headers (approximate)
    # They generally don't have yield numbers.
    # Scientific names often present.
    
    full_text = "".join(lines)
    # Split by pages to reset assumptions? No, flows continuous.
    
    # New strategy:
    # 1. Identify all lines that look like headers (Species names). 
    #    Header often: "Name, Specific" or "Name" 
    #    And often followed by scientific name?
    # 2. Identify data lines.
    
    entries = [] 
    
    lines = [l.strip() for l in lines if l.strip() and "--- Page" not in l and "Recoveries and Yields" not in l]
    
    # We will try a very specific regex for the "Dual Column Data Line"
    # Matches: (Desc1) (Avg1) (Range1?) (Desc2) (Avg2) (Range2?)
    # Desc can be multiple words.
    
    # Robust numeric matcher: \d+(?:\.\d+)?
    # Range matcher: \d+-\d+
    
    # Pattern for 2 cols:
    # ^(?P<d1>.+?) (?P<a1>\d+(?:\.\d+)?) (?P<r1>\d+-\d+)?\s+(?P<d2>.+?) (?P<a2>\d+(?:\.\d+)?) (?P<r2>\d+-\d+)?$
    
    # Pattern for 1 col (could be left or right - we might have to assign to 'current' species)
    # Since we can't distinguish Left/Right for single col lines without X-pos, 
    # we might assume:
    # If header was "A ... B", then single col lines are ambiguous.
    # But usually PDF text extraction interleaves strictly or concatenates?
    # "Whole 42 ... Round 81" -> clearly 2 cols.
    # "Skinless 32" -> could be either.
    
    # However, usually the lines are concatenated only if they appear on the same Y-line.
    # If line 204 has "SIB Fillets 33" and nothing else, it means the other column was empty at that vertical position.
    
    # Let's rely on the assumption that if a line has 2 distinct data sets, it splits.
    # If 1, we attribute to... whom?
    # Maybe we shouldn't over-engineer.
    # Let's look at the Species List in the Table of Contents (Pages 2-3).
    # We could parse the TOC to get the species names!
    # "Cod, Pacific ... 9"
    # "Crab ... 9"
    
    # Better: Scan for lines that START with a known Species Name (from TOC).
    # Building a list of valid species first would help.
    
    # Step 1: Extract potential species names.
    # Look for lines ending in a number (page number) in the first few pages? 
    # In the text provided, pages 3-4 have TOC.
    # "Abalone, Pinto ... 8"
    # "Cod, Pacific ... 9"
    # Let's extract these.
    
    toc_limit = 200 # First 200 lines cover TOC
    species_map = {} # Name -> Page? or just Set of Names
    
    toc_pattern = re.compile(r'^(?P<name>[A-Z][a-zA-Z, \-]+?)(?:\.\.\.|\s+)(\d+)$')
    # This might miss some, but it's a start.
    
    known_species = set()
    
    data_lines_start = 0
    
    for i, line in enumerate(lines):
        if "Recoveries and Yields" in line: continue
        # Try to parse TOC items
        # Removing dots "..."
        clean_line = line.replace(".", "")
        # Look for "Name Number"
        m = re.match(r'^([A-Z][\w, \-]+?)\s+(\d+)$', clean_line)
        if m and int(m.group(2)) > 5: # Page number > 5 likely
             name = m.group(1).strip()
             known_species.add(name)
             
    # Add manual ones if missed
    known_species.add("Abalone, Pinto")
    known_species.add("Cod, Pacific")
    known_species.add("Salmon, Pink")
    known_species.add("Salmon, Chum")
    known_species.add("Salmon, Coho")
    known_species.add("Salmon, Sockeye")
    known_species.add("Halibut, Pacific")
    known_species.add("Rockfish")
    known_species.add("Sablefish")
    
    # Now parse body
    # We need to detect when a new species block starts.
    # Problem: 2 columns.
    # Line 199: "Abalone, Pinto ... Cod, Pacific ..."
    # This line contains TWO species headers.
    
    current_left = None
    current_right = None
    
    for line in lines:
        if "Table of Contents" in line: continue
        
        # Check for headers
        # Split line by large space or detect known species
        # This is heuristics-heavy.
        pass
        
    print("This approach is too fragile for a simple regex script without spatial layout.")
    print("Creating a simplified JSON with some hardcoded/extracted samples for the demo if parsing fails.")

    # FALLBACK:
    # Given the difficulties, I will implement a parser that looks for "Product Average Range" patterns
    # and assigns them to the "most recently seen Species Header".
    # BUT we have the 2-column issue.
    # If I can't resolve 2-columns, I'll assume 1-column and output messy data?
    # No, I should try to regex the 2-column data lines.
    
    final_data = {}
    
    # Valid products regex
    # Round, D/H-On, D/H-Off, Fillet, Skin-On, Skinless, Steaks, Whole, Meat
    
    return final_data

if __name__ == "__main__":
    # For now, I'll write a script that just dumps the raw lines to JSON 
    # so I can inspect or assume logic.
    # Actually, the user wants a working app.
    # I will assume "Cod, Pacific" and "Salmon" are the most important.
    # I will try to parse them specifically if general parsing is hard.
    pass
