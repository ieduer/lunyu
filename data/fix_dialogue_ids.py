#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import os
from collections import Counter

# --- Configuration ---
INPUT_FILENAME = 'dialogues.json'
OUTPUT_FILENAME = 'dialogues_fixed.json'
# --- End Configuration ---

def find_duplicates(data):
    """Checks for duplicate IDs and returns a dictionary of duplicates."""
    ids = [item.get('id') for item in data if item.get('id') is not None]
    id_counts = Counter(ids)
    duplicates = {id_val: count for id_val, count in id_counts.items() if count > 1}
    return duplicates

def fix_dialogue_ids(input_path, output_path):
    """Reads the JSON, fixes IDs sequentially, and writes to a new file."""
    print(f"Attempting to read '{input_path}'...")
    try:
        # Read the JSON file with UTF-8 encoding
        with open(input_path, 'r', encoding='utf-8') as infile:
            dialogues = json.load(infile)
        print(f"Successfully read {len(dialogues)} entries.")

    except FileNotFoundError:
        print(f"Error: Input file '{input_path}' not found in the current directory '{os.getcwd()}'.")
        return False
    except json.JSONDecodeError as e:
        print(f"Error decoding JSON from '{input_path}': {e}")
        return False
    except Exception as e:
        print(f"An unexpected error occurred during reading: {e}")
        return False

    # Check for duplicates before fixing (optional but informative)
    duplicates_found = find_duplicates(dialogues)
    if duplicates_found:
        print("\n--- Duplicate IDs Found (Before Fixing) ---")
        for dup_id, count in duplicates_found.items():
            print(f"  ID {dup_id} appears {count} times.")
        print("-------------------------------------------")
    else:
        print("\nNo duplicate IDs found, but will renumber sequentially anyway.")

    # Renumber IDs sequentially starting from 1
    fixed_dialogues = []
    current_id = 1
    print("\nRenumbering IDs...")
    for i, entry in enumerate(dialogues):
        old_id = entry.get('id', 'N/A')
        entry['id'] = current_id
        # Optionally print changes for verification, can be noisy for large files
        # if old_id != current_id:
        #     print(f"  Index {i}: Changed ID from {old_id} to {current_id} (Title: {entry.get('title', 'N/A')})")
        # else:
        #     print(f"  Index {i}: Kept ID {current_id} (Title: {entry.get('title', 'N/A')})")

        fixed_dialogues.append(entry)
        current_id += 1

    print(f"Finished renumbering. Total entries: {len(fixed_dialogues)}.")

    # Check for duplicates after fixing (should be none)
    duplicates_after = find_duplicates(fixed_dialogues)
    if duplicates_after:
        print("\nError: Duplicates still found after renumbering! This shouldn't happen.")
        for dup_id, count in duplicates_after.items():
             print(f"  ID {dup_id} appears {count} times.")
        return False
    else:
        print("Verification successful: No duplicate IDs in the fixed data.")


    print(f"\nAttempting to write fixed data to '{output_path}'...")
    try:
        # Write the fixed data to a new JSON file
        with open(output_path, 'w', encoding='utf-8') as outfile:
            # ensure_ascii=False preserves Chinese characters
            # indent=2 makes the file human-readable (matches input style)
            json.dump(fixed_dialogues, outfile, ensure_ascii=False, indent=2)
        print(f"Successfully wrote fixed data to '{output_path}'.")
        return True

    except IOError as e:
        print(f"Error writing to '{output_path}': {e}")
        return False
    except Exception as e:
        print(f"An unexpected error occurred during writing: {e}")
        return False

if __name__ == "__main__":
    if fix_dialogue_ids(INPUT_FILENAME, OUTPUT_FILENAME):
        print("\nScript finished successfully.")
    else:
        print("\nScript finished with errors.")