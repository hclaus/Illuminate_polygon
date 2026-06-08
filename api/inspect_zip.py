import zipfile
import io
import json
import os
from guv_calcs.project import Project

def inspect():
    zip_path = os.path.join('..', 'illuminate (4).zip')
    if not os.path.exists(zip_path):
        # maybe it's in the current directory if run from workspace root
        zip_path = 'illuminate (4).zip'
    
    with zipfile.ZipFile(zip_path, 'r') as z:
        guv_data = z.read('room.guv')
        
        # Try loading Project
        try:
            proj = Project.load(io.BytesIO(guv_data))
        except Exception as e:
            try:
                proj = Project.load_from_bytes(guv_data)
            except Exception as e2:
                print("Failed to load project:", e, e2)
                return
        
        print("Project loaded successfully. Calc zones:")
        for k, zone in proj.calc_zones.items():
            name = getattr(zone, 'name', None)
            display_mode = getattr(zone, 'display_mode', None)
            contour_settings = getattr(zone, 'contour_settings', None)
            has_values = getattr(zone, 'values', None) is not None
            print(f"- Key: {k}")
            print(f"  Name: {name}")
            print(f"  Display Mode: {display_mode}")
            print(f"  Has Values: {has_values}")
            print(f"  Contour Settings: {contour_settings}")
            print("-" * 40)

if __name__ == '__main__':
    inspect()
