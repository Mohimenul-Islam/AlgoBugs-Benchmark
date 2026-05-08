import os
import zipfile
import json
from collections import defaultdict

DATASET_DIR = "/home/mohimenul/thesis-final-run/dataset-final"

def analyze_datasets():
    print("Analyzing datasets...\n")
    
    total_problems = 0
    total_valid_pairs = 0
    incomplete_problems = []
    
    # Iterate through rating directories
    for rating_dir in sorted(os.listdir(DATASET_DIR)):
        rating_path = os.path.join(DATASET_DIR, rating_dir)
        if not os.path.isdir(rating_path):
            continue
            
        print(f"--- Rating: {rating_dir} ---")
        
        # Iterate through zip files
        for zip_name in os.listdir(rating_path):
            if not zip_name.endswith('.zip'):
                continue
                
            problem_id = zip_name.replace('.zip', '')
            zip_path = os.path.join(rating_path, zip_name)
            
            valid_pairs = 0
            invalid_pairs = 0
            pair_folders = set()
            
            try:
                with zipfile.ZipFile(zip_path, 'r') as z:
                    files = z.namelist()
                    
                    # Extract pair folder names
                    for f in files:
                        parts = f.split('/')
                        if len(parts) > 0 and 'pair' in parts[0].lower():
                            pair_folders.add(parts[0])
                            
                    for pair_folder in pair_folders:
                        # Check for correct and buggy solutions
                        correct_files = [f for f in files if f.startswith(f"{pair_folder}/solution_correct")]
                        buggy_files = [f for f in files if f.startswith(f"{pair_folder}/solution_buggy")]
                        
                        has_correct = False
                        has_buggy = False
                        
                        for cf in correct_files:
                            info = z.getinfo(cf)
                            if info.file_size > 10:  # Arbitrary small size to detect empty files
                                has_correct = True
                                
                        for bf in buggy_files:
                            info = z.getinfo(bf)
                            if info.file_size > 10:
                                has_buggy = True
                                
                        if has_correct and has_buggy:
                            valid_pairs += 1
                        else:
                            invalid_pairs += 1
            except Exception as e:
                print(f"Error reading {zip_name}: {e}")
                continue
                
            total_problems += 1
            total_valid_pairs += valid_pairs
            
            status = "✅ Complete" if valid_pairs >= 25 else "❌ Incomplete"
            
            if valid_pairs < 25:
                incomplete_problems.append({
                    "rating": rating_dir,
                    "problem_id": problem_id,
                    "valid_pairs": valid_pairs,
                    "missing": 25 - valid_pairs
                })
            
            print(f"  {problem_id}: {valid_pairs} valid pairs, {invalid_pairs} invalid pairs. {status}")
    
    print("\n" + "="*40)
    print("SUMMARY")
    print("="*40)
    print(f"Total Problems Analyzed: {total_problems} / 40")
    print(f"Total Valid Pairs Found: {total_valid_pairs}")
    print(f"Total Problems Needing AI Fill-up: {len(incomplete_problems)}")
    
    print("\nACTION REQUIRED: FILL UP THESE DATASETS:")
    for prob in incomplete_problems:
        print(f"- {prob['rating']}/{prob['problem_id']}: Has {prob['valid_pairs']} pairs. Needs {prob['missing']} more pairs.")

if __name__ == "__main__":
    analyze_datasets()
