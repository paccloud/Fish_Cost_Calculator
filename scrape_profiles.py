import requests
import re
import json

def scrape_profiles():
    base_url = "https://caseagrant.ucsd.edu/seafood-profiles"
    
    # Fetch main list
    print(f"Fetching {base_url}...")
    try:
        r = requests.get(base_url)
        if r.status_code != 200:
            print("Failed to fetch main page")
            return
            
        html = r.text
        # Pattern to find links to seafood profiles
        # We look for hrefs that contain 'seafood-profiles/' but are not the index page itself
        # They might be absolute or relative.
        links = re.findall(r'href="((?:https://caseagrant\.ucsd\.edu)?/seafood-profiles/[^"]+)"', html)
        
        # Filter duplicates and extract names
        # We need to clean the hrefs to be always full URLs
        clean_links = []
        for l in links:
            if "page=" in l: continue # Skip pagination
            if l.endswith("/seafood-profiles"): continue
            if "http" not in l:
                l = "https://caseagrant.ucsd.edu" + l
            
            # Name extraction is harder from just href if regex failed.
            # We will fetch name from the page or guess from slug.
            slug = l.split("/")[-1].replace("-", " ").title()
            clean_links.append((l, slug))
            
        clean_links = list(set(clean_links))
        links = clean_links # override

        print(f"Found {len(links)} profiles.")
        
        profiles = {}
        
        # Limit to 5 for test/demo speed, or do all?
        # User said "Include data from this".
        # I'll try 10 key species.
        
        count = 0
        for href, name in links:
            if count > 15: break # Safety limit for now
            
            full_url = href # href is already cleaned to be full URL
            print(f"Scraping {name}...")

            
            try:
                pr = requests.get(full_url)
                p_text = pr.text
                
                # Extract sections
                # Simple region extraction
                desc_match = re.search(r'Description of meat</h3>(.*?)<h3', p_text, re.DOTALL)
                uses_match = re.search(r'Culinary uses</h3>(.*?)<h3', p_text, re.DOTALL)
                edible_match = re.search(r'Edible portions</h3>(.*?)<h3', p_text, re.DOTALL)
                
                def clean_html(t):
                    if not t: return ""
                    return re.sub(r'<[^>]+>', '', t).strip()
                
                profiles[name] = {
                    "description": clean_html(desc_match.group(1)) if desc_match else "",
                    "culinary_uses": clean_html(uses_match.group(1)) if uses_match else "",
                    "edible_portions": clean_html(edible_match.group(1)) if edible_match else "",
                    "url": full_url
                }
                
                count += 1
            except Exception as e:
                print(f"Error scraping {name}: {e}")
                
        # Save to JSON
        with open('data/profiles_data.json', 'w') as f:
            json.dump(profiles, f, indent=4)
            
        print("Scraping complete.")
        
    except Exception as e:
        print(f"Fatal error: {e}")

if __name__ == "__main__":
    scrape_profiles()
