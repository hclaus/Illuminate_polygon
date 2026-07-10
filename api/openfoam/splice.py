"""Splice constant/fvOptions into the scalarTransport function object's
nested fvOptions{} block inside system/controlDict.

We're not running a normal solver that reads constant/fvOptions on its own -
the UV scalar transport is handled by the `scalarTransport` function object
attached in controlDict, which only sees sources copy-pasted into its own
nested fvOptions{} sub-block. Every time the mesh (and therefore
constant/fvOptions' cellZone contents) is regenerated, that nested block goes
stale and must be re-spliced with the fresh content.
"""
import re


def _read_fvoptions_body(fvoptions_path):
    """Return constant/fvOptions' content with the FoamFile header stripped."""
    with open(fvoptions_path) as f:
        content = f.read()
    # Strip the FoamFile{...} header block, keep everything after its closing '}'.
    m = re.search(r'^FoamFile\s*\n\{.*?\n\}\s*\n', content, re.DOTALL | re.MULTILINE)
    if not m:
        raise RuntimeError(f"Could not find FoamFile header block in {fvoptions_path}")
    return content[m.end():].strip("\n")


def _find_matching_brace(text, open_brace_pos):
    """Given the index of an opening '{', return the index of its matching '}'."""
    depth = 0
    i = open_brace_pos
    while i < len(text):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise RuntimeError("Unbalanced braces: no matching '}' found")


def splice_fv_options_into_control_dict(case_dir, indent="        "):
    """Replace the stale nested fvOptions{} block inside controlDict's
    scalarTransport function object with the freshly-generated
    constant/fvOptions content. Returns (controlDict_path, n_open, n_close)
    so the caller can verify brace balance.
    """
    fv_body = _read_fvoptions_body(f"{case_dir}/constant/fvOptions")
    indented_body = "\n".join(indent + line if line else "" for line in fv_body.splitlines())

    cd_path = f"{case_dir}/system/controlDict"
    with open(cd_path) as f:
        content = f.read()

    m = re.search(r'\n(\s*)fvOptions\s*\n(\s*)\{', content)
    if not m:
        raise RuntimeError("Could not find 'fvOptions' block inside controlDict")
    keyword_indent = m.group(1)
    open_brace_pos = content.index("{", m.end() - 1)
    close_brace_pos = _find_matching_brace(content, open_brace_pos)

    new_content = (
        content[:open_brace_pos + 1]
        + "\n" + indented_body + "\n" + keyword_indent
        + content[close_brace_pos:]
    )

    with open(cd_path, "w") as f:
        f.write(new_content)

    n_open = new_content.count("{")
    n_close = new_content.count("}")
    return cd_path, n_open, n_close
