import os
import zipfile
import re

dataset_root = "/home/mohimenul/thesis-final-run/dataset-final"
rating_dirs = sorted([d for d in os.listdir(dataset_root) if os.path.isdir(os.path.join(dataset_root, d))])

required_files = ["metadata.json", "problem_statement.md", "solution_correct.cpp", "solution_buggy.cpp"]

results = []
total_problems = 0

for rating in rating_dirs:
    rating_path = os.path.join(dataset_root, rating)
    zip_files = [f for f in os.listdir(rating_path) if f.endswith('.zip')]
    
    for zip_name in sorted(zip_files):
        total_problems += 1
        problem_id = zip_name.replace(".zip", "")
        zip_path = os.path.join(rating_path, zip_name)
        
        try:
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                namelist = zip_ref.namelist()
                
                # Group files by pair
                pairs = {}
                for name in namelist:
                    match = re.search(r"pair(\d+)/", name)
                    if match:
                        pair_num = int(match.group(1))
                        if pair_num not in pairs:
                            pairs[pair_num] = []
                        
                        basename = os.path.basename(name)
                        if basename in required_files:
                            pairs[pair_num].append(basename)
                
                # Check constraints
                pair_count = len(pairs)
                valid_pairs = 0
                incomplete_pairs = []
                
                for i in range(1, 26):
                    if i in pairs:
                        missing = set(required_files) - set(pairs[i])
                        if not missing:
                            valid_pairs += 1
                        else:
                            incomplete_pairs.append(f"pair{i} missing {list(missing)}")
                    else:
                        incomplete_pairs.append(f"pair{i} totally missing")
                
                extra_pairs = [p for p in pairs.keys() if p > 25]
                
                status = "OK" if valid_pairs == 25 and not extra_pairs else "FAIL"
                results.append({
                    "rating": rating,
                    "problem": problem_id,
                    "count": valid_pairs,
                    "extra": extra_pairs,
                    "incomplete": incomplete_pairs,
                    "status": status
                })
        except Exception as e:
            results.append({
                "rating": rating,
                "problem": problem_id,
                "status": f"ERROR: {str(e)}"
            })

print(f"{'Rating':<10} | {'Problem':<10} | {'Valid Pairs':<12} | {'Status'}")
print("-" * 50)
for res in results:
    print(f"{res['rating']:<10} | {res['problem']:<10} | {res.get('count', 'N/A'):<12} | {res['status']}")

print("\nDetailed Failures:")
failed = [res for res in results if res['status'] != "OK"]
if not failed:
    print("None! All 40 problems are pixel-perfect.")
else:
    for f in failed:
        print(f"--- {f['rating']}/{f['problem']} ---")
        if 'incomplete' in f and f['incomplete']:
            print("  Incomplete/Missing: " + ", ".join(f['incomplete'][:5]) + ("..." if len(f['incomplete']) > 5 else ""))
        if 'extra' in f and f['extra']:
            print(f"  Extra pairs found: {f['extra']}")

print(f"\nTotal problems audited: {total_problems}")
