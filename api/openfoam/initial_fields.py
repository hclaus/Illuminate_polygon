"""Generate 0/ initial condition field files for the topoSet-carved 8-patch
mesh (inlet, outlet, xMinWall, xMaxWall, floor, ceiling, frontWall, backWall).

Boundary condition types/values are ported from the original working case
(roomVent_scalar_uv): same physics setup (inlet velocity/turbulence, wall
functions, T=1 initial contamination decaying via a clean-air inlet), just
with leftWall/rightWall renamed to xMinWall/xMaxWall, and internalField
reset to uniform values since the original's internalField was solved data
copied from a later timestep on a *different* mesh (different cell count/
topology) - not valid to reuse directly.
"""

_WALL_PATCHES = ("xMinWall", "xMaxWall", "floor", "ceiling", "frontWall", "backWall")

_FIELD_SPECS = {
    "U": {
        "foam_class": "volVectorField",
        "dimensions": "[0 1 -1 0 0 0 0]",
        "internal": "uniform (0 0 0)",
        "inlet": ("fixedValue", "uniform (0.278 0 0)"),
        "outlet": ("inletOutlet", None, "inletValue uniform (0 0 0);\n        value           uniform (0 0 0);"),
        "wall": ("noSlip", None),
    },
    "p": {
        "foam_class": "volScalarField",
        "dimensions": "[0 2 -2 0 0 0 0]",
        "internal": "uniform 0",
        "inlet": ("zeroGradient", None),
        "outlet": ("fixedValue", "uniform 0"),
        "wall": ("zeroGradient", None),
    },
    "k": {
        "foam_class": "volScalarField",
        "dimensions": "[0 2 -2 0 0 0 0]",
        "internal": "uniform 0.0039",
        "inlet": ("fixedValue", "uniform 0.0039"),
        "outlet": ("inletOutlet", None, "inletValue uniform 0.001;\n        value           uniform 0.001;"),
        "wall": ("kqRWallFunction", "uniform 1e-5"),
    },
    "omega": {
        "foam_class": "volScalarField",
        "dimensions": "[0 0 -1 0 0 0 0]",
        "internal": "uniform 5.43",
        "inlet": ("fixedValue", "uniform 5.43"),
        "outlet": ("inletOutlet", None, "inletValue uniform 5.43;\n        value           uniform 5.43;"),
        "wall": ("omegaWallFunction", "uniform 5.43"),
    },
    "nut": {
        "foam_class": "volScalarField",
        "dimensions": "[0 2 -1 0 0 0 0]",
        "internal": "uniform 0",
        "inlet": ("calculated", "uniform 0"),
        "outlet": ("calculated", "uniform 0"),
        "wall": ("nutkWallFunction", "uniform 0"),
    },
    "T": {
        "foam_class": "volScalarField",
        "dimensions": "[0 0 0 0 0 0 0]",
        "internal": "uniform 1",
        "inlet": ("fixedValue", "uniform 0"),
        "outlet": ("zeroGradient", None),
        "wall": ("zeroGradient", None),
    },
}


def _patch_block(spec_entry):
    if len(spec_entry) == 3:
        bc_type, _, extra = spec_entry
        return [f"        type            {bc_type};", f"        {extra}"]
    bc_type, value = spec_entry
    lines = [f"        type            {bc_type};"]
    if value is not None:
        lines.append(f"        value           {value};")
    return lines


def field_file_content(field_name, time_dir="0"):
    spec = _FIELD_SPECS[field_name]
    lines = [
        "FoamFile", "{", "    version     2.0;", "    format      ascii;",
        f"    class       {spec['foam_class']};", f'    location    "{time_dir}";',
        f"    object      {field_name};", "}", "",
        f"dimensions      {spec['dimensions']};", "",
        f"internalField   {spec['internal']};", "",
        "boundaryField", "{",
        "    inlet", "    {",
    ]
    lines += ["    " + l for l in _patch_block(spec["inlet"])]
    lines += ["    }", "    outlet", "    {"]
    lines += ["    " + l for l in _patch_block(spec["outlet"])]
    lines += ["    }"]
    for patch in _WALL_PATCHES:
        lines += [f"    {patch}", "    {"]
        lines += ["    " + l for l in _patch_block(spec["wall"])]
        lines += ["    }"]
    lines += ["}", ""]
    return "\n".join(lines)


def write_initial_fields(case_dir, time_dir="0"):
    """Write U, p, k, omega, nut, T into <case_dir>/<time_dir>/. Returns written paths."""
    paths = {}
    for field_name in _FIELD_SPECS:
        path = f"{case_dir}/{time_dir}/{field_name}"
        with open(path, "w") as f:
            f.write(field_file_content(field_name, time_dir))
        paths[field_name] = path
    return paths
