"""Shared helpers for session router modules.

Contains dependency injection (session/auth), common helper functions,
and shared constants used across session_core, lamp, zone, and
calculation routers.
"""

import os
import re
import logging

from fastapi import HTTPException, UploadFile, Header, Depends
from typing import Optional, Dict, Any, Annotated

from guv_calcs import WHOLE_ROOM_FLUENCE, EYE_LIMITS, SKIN_LIMITS
from guv_calcs.lamp import Lamp
from guv_calcs.room import Room
from guv_calcs import SurfaceGrid, VolumeGrid
from guv_calcs.calc_zone import CalcPlane, CalcVol, CalcPoint

import numpy as np

from .session_manager import Session, get_session_manager
from .session_schemas import LoadedLamp, LoadedZone

logger = logging.getLogger(__name__)

# Allow skipping auth in development for easier testing
DEV_MODE = os.getenv("DEV_MODE", "false").lower() == "true"

# Target species for disinfection table
TARGET_SPECIES = ["Human coronavirus", "Influenza virus", "Staphylococcus aureus"]

# Map guv_calcs GUVType enum values to frontend lamp type strings.
_GUV_TYPE_MAP = {"krcl": "krcl_222", "lphg": "lp_254"}


def _guv_type_to_frontend(lamp) -> str:
    """Derive the frontend lamp_type string from a guv_calcs Lamp's guv_type."""
    guv_val = getattr(lamp.guv_type, 'value', None) if hasattr(lamp, 'guv_type') else None
    return _GUV_TYPE_MAP.get(guv_val, "other")


# ============================================================
# Dependency Injection
# ============================================================

def get_session_id(
    x_session_id: Annotated[Optional[str], Header(alias="X-Session-ID")] = None
) -> str:
    """Extract session ID from header."""
    if not x_session_id:
        raise HTTPException(
            status_code=400,
            detail="Missing X-Session-ID header. Initialize a session first."
        )
    return x_session_id


SessionIdDep = Annotated[str, Depends(get_session_id)]


def _validate_session_token(session: Session, session_id: str, authorization: Optional[str]) -> None:
    """Validate the Bearer token for an existing session.

    Raises HTTPException on failure.  No-ops in DEV_MODE.
    """
    if DEV_MODE:
        logger.debug(f"DEV_MODE: Skipping token validation for session {session_id[:8]}...")
        return

    if not session.token_hash:
        logger.warning(f"Session {session_id[:8]}... has no token_hash (legacy session)")
        raise HTTPException(
            status_code=401,
            detail="Session requires re-authentication. Please refresh the page."
        )

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization token required")

    token = authorization.replace("Bearer ", "")
    if not session.verify_token(token):
        raise HTTPException(status_code=401, detail="Invalid session token")


def get_session(
    session_id: SessionIdDep,
    authorization: Annotated[Optional[str], Header()] = None
) -> Session:
    """Get the session for the current request with token validation."""
    manager = get_session_manager()
    session = manager.get_session(session_id, auto_create=False)
    if session is None:
        raise HTTPException(
            status_code=404,
            detail="Session not found. Initialize a session first with POST /session/init"
        )
    _validate_session_token(session, session_id, authorization)
    return session


def get_or_create_session(
    session_id: SessionIdDep,
    authorization: Annotated[Optional[str], Header()] = None
) -> Session:
    """Get or create a session (used by /session/init)."""
    manager = get_session_manager()
    session = manager.get_session(session_id, auto_create=False)
    if session is None:
        raise HTTPException(status_code=401, detail="Session expired. Please create a new session.")
    _validate_session_token(session, session_id, authorization)
    return session


def require_initialized_session(session: Session = Depends(get_session)) -> Session:
    """Require that the session has an initialized Project."""
    if session.project is None:
        raise HTTPException(
            status_code=400,
            detail="No active session. Call POST /session/init first."
        )
    return session


SessionDep = Annotated[Session, Depends(get_session)]
InitializedSessionDep = Annotated[Session, Depends(require_initialized_session)]
SessionCreateDep = Annotated[Session, Depends(get_or_create_session)]


# ============================================================
# Common Helpers
# ============================================================

def _log_and_raise(operation: str, e: Exception, status_code: int = 400) -> None:
    """Log error details server-side and raise a generic HTTPException.

    If the exception is already an HTTPException (e.g. from check_budget),
    re-raise it directly to preserve structured error details.
    """
    logger.error(f"{operation}: {e}", exc_info=True)
    if isinstance(e, HTTPException):
        raise e
    raise HTTPException(status_code=status_code, detail=f"{operation}: {e}")


def _get_lamp_or_404(session: Session, lamp_id: str) -> Lamp:
    """Get a lamp from the session's lamp_id_map or raise 404."""
    lamp = session.lamp_id_map.get(lamp_id)
    if lamp is None:
        raise HTTPException(status_code=404, detail=f"Lamp {lamp_id} not found")
    return lamp


def _get_zone_or_404(session: Session, zone_id: str):
    """Get a zone from the session's zone_id_map or raise 404."""
    zone = session.zone_id_map.get(zone_id)
    if zone is None:
        raise HTTPException(status_code=404, detail=f"Zone {zone_id} not found")
    return zone


async def _read_and_validate_upload(
    file: UploadFile, max_size: int, validator_fn=None
) -> bytes:
    """Read an uploaded file with size validation and optional content validation."""
    if file.size and file.size > max_size:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {max_size // 1024} KB"
        )
    data = await file.read(max_size + 1)
    if len(data) > max_size:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {max_size // 1024} KB"
        )
    if validator_fn is not None and not validator_fn(data):
        raise HTTPException(
            status_code=400,
            detail="Invalid file format"
        )
    return data


def _get_state_hashes(session: Session) -> Dict[str, Any]:
    """Compute current state hashes from a session's room."""
    room = session.room
    return {
        "calc_state": room.get_calc_state(),
        "update_state": room.get_update_state(),
    }


def _sanitize_filename(name: str) -> str:
    """Sanitize a string for use in Content-Disposition filename."""
    sanitized = re.sub(r'[^\w\s\-.]', '_', name)
    sanitized = re.sub(r'[_\s]+', '_', sanitized)
    sanitized = sanitized.strip('_ ')
    return sanitized or 'export'


def _standard_to_label(standard) -> str:
    """Convert guv_calcs PhotStandard to its canonical label."""
    return getattr(standard, 'label', str(standard))


def _decompose_time(zone):
    """Decompose zone exposure_time timedelta into h/m/s."""
    total = zone.exposure_time.total_seconds()
    h = int(total // 3600)
    remaining = total - h * 3600
    m = int(remaining // 60)
    s = remaining - m * 60
    s = round(s, 6)
    return h, m, s


def _create_lamp_from_input(lamp_input, units=None) -> Lamp:
    """Create a guv_calcs Lamp from session input"""
    id_kwarg = {"lamp_id": lamp_input.id} if lamp_input.id is not None else {}
    units_kwarg = {"units": units} if units is not None else {}

    logger.info(f"Creating lamp: id={lamp_input.id}, preset_id={lamp_input.preset_id!r}, lamp_type={lamp_input.lamp_type}")

    if lamp_input.preset_id and lamp_input.preset_id != "custom" and lamp_input.preset_id != "":
        logger.info(f"Using Lamp.from_keyword with preset: {lamp_input.preset_id}")
        lamp = Lamp.from_keyword(
            lamp_input.preset_id,
            **id_kwarg,
            **units_kwarg,
            x=lamp_input.x,
            y=lamp_input.y,
            z=lamp_input.z,
            angle=lamp_input.angle,
            aimx=lamp_input.aimx,
            aimy=lamp_input.aimy,
            aimz=lamp_input.aimz,
            scaling_factor=lamp_input.scaling_factor,
        )
        lamp.preset_id = lamp_input.preset_id
        logger.info(f"Created preset lamp: has_ies={lamp.ies is not None}")
    elif lamp_input.lamp_type == "other":
        wavelength = lamp_input.wavelength
        if wavelength is None:
            raise HTTPException(
                status_code=400,
                detail="wavelength is required for 'other' lamp type"
            )
        logger.info(f"Using plain Lamp() constructor for 'other' type (wavelength={wavelength})")
        lamp = Lamp(
            **id_kwarg,
            **units_kwarg,
            x=lamp_input.x,
            y=lamp_input.y,
            z=lamp_input.z,
            wavelength=wavelength,
            angle=lamp_input.angle,
            aimx=lamp_input.aimx,
            aimy=lamp_input.aimy,
            aimz=lamp_input.aimz,
            scaling_factor=lamp_input.scaling_factor,
        )
        logger.info(f"Created 'other' lamp: wavelength={wavelength}, has_ies={lamp.ies is not None}")
    else:
        wavelength = 222 if lamp_input.lamp_type == "krcl_222" else 254
        guv_type = "KRCL" if lamp_input.lamp_type == "krcl_222" else "LPHG"
        logger.info(f"Using plain Lamp() constructor (no preset)")
        lamp = Lamp(
            **id_kwarg,
            **units_kwarg,
            x=lamp_input.x,
            y=lamp_input.y,
            z=lamp_input.z,
            wavelength=wavelength,
            guv_type=guv_type,
            angle=lamp_input.angle,
            aimx=lamp_input.aimx,
            aimy=lamp_input.aimy,
            aimz=lamp_input.aimz,
            scaling_factor=lamp_input.scaling_factor,
        )
        logger.info(f"Created custom lamp: has_ies={lamp.ies is not None}")

    lamp.enabled = lamp_input.enabled
    lamp.visible = getattr(lamp_input, 'visible', True)
    if lamp_input.name is not None:
        lamp.name = lamp_input.name
    # Persist "custom" so it survives save/load (guv_calcs serializes preset_id)
    if lamp_input.preset_id == "custom":
        lamp.preset_id = "custom"
    return lamp


def _create_zone_from_input(zone_input, room: Room):
    """Create a guv_calcs CalcPlane or CalcVol from session input."""
    if zone_input.id in (EYE_LIMITS, SKIN_LIMITS, WHOLE_ROOM_FLUENCE):
        room.add_standard_zones(on_collision="overwrite")
        zone = room.calc_zones.get(zone_input.id)
        if zone is not None:
            zone.enabled = zone_input.enabled
            zone.visible = getattr(zone_input, 'visible', True)
            if hasattr(zone_input, 'display_mode') and zone_input.display_mode is not None:
                zone.display_mode = zone_input.display_mode
            if hasattr(zone_input, 'contour_settings') and zone_input.contour_settings is not None:
                zone.contour_settings = zone_input.contour_settings
            return zone
        logger.warning(f"add_standard_zones() did not create {zone_input.id}, falling back to manual creation")

    if zone_input.type == "plane":
        x1_val = zone_input.x1 if zone_input.x1 is not None else 0
        x2_val = zone_input.x2 if zone_input.x2 is not None else room.x
        x1_val, x2_val = min(x1_val, x2_val), max(x1_val, x2_val)
        y1_val = zone_input.y1 if zone_input.y1 is not None else 0
        y2_val = zone_input.y2 if zone_input.y2 is not None else room.y
        y1_val, y2_val = min(y1_val, y2_val), max(y1_val, y2_val)

        grid_kwargs = {}
        if zone_input.num_x is not None and zone_input.num_y is not None:
            grid_kwargs["num_points_init"] = (zone_input.num_x, zone_input.num_y)
        elif zone_input.x_spacing is not None and zone_input.y_spacing is not None:
            grid_kwargs["spacing_init"] = (zone_input.x_spacing, zone_input.y_spacing)
        if zone_input.offset is not None:
            grid_kwargs["offset"] = zone_input.offset

        geometry = SurfaceGrid.from_legacy(
            mins=(x1_val, y1_val),
            maxs=(x2_val, y2_val),
            height=zone_input.height if zone_input.height is not None else 1.0,
            ref_surface=zone_input.ref_surface if zone_input.ref_surface is not None else "xy",
            direction=zone_input.direction if zone_input.direction not in (None, 0) else 1,
            **grid_kwargs,
        )
        # view_direction and view_target are mutually exclusive in guv_calcs.
        # The frontend store may carry both (stale value from a previous mode),
        # so only pass the one that matches the current calc_mode.
        vd = zone_input.view_direction
        vt = zone_input.view_target
        if vd is not None and vt is not None:
            # Resolve conflict: keep the one matching calc_mode, clear the other
            if zone_input.calc_mode == "eye_target":
                vd = None
            else:
                vt = None

        zone = CalcPlane(
            zone_id=zone_input.id,
            name=zone_input.name,
            geometry=geometry,
            calc_mode=zone_input.calc_mode,
            horiz=zone_input.horiz,
            vert=zone_input.vert,
            fov_vert=zone_input.fov_vert,
            fov_horiz=zone_input.fov_horiz,
            use_normal=zone_input.use_normal if zone_input.use_normal is not None else (zone_input.direction != 0 if zone_input.direction is not None else None),
            view_direction=vd,
            view_target=vt,
            dose=zone_input.dose,
            hours=zone_input.hours, minutes=zone_input.minutes, seconds=zone_input.seconds,
        )
    elif zone_input.type == "point":
        position = (
            zone_input.x if zone_input.x is not None else room.x / 2,
            zone_input.y if zone_input.y is not None else room.y / 2,
            zone_input.z if zone_input.z is not None else 1.0,
        )
        aim_point = (
            zone_input.aim_x if zone_input.aim_x is not None else position[0],
            zone_input.aim_y if zone_input.aim_y is not None else position[1],
            zone_input.aim_z if zone_input.aim_z is not None else position[2] + 1.0,
        )
        zone = CalcPoint.at(
            position=position,
            aim_point=aim_point,
            zone_id=zone_input.id,
            name=zone_input.name,
            horiz=zone_input.horiz if zone_input.horiz is not None else True,
            vert=zone_input.vert if zone_input.vert is not None else False,
            use_normal=True,
            fov_vert=zone_input.fov_vert if zone_input.fov_vert is not None else 180,
            fov_horiz=zone_input.fov_horiz if zone_input.fov_horiz is not None else 360,
            dose=zone_input.dose,
            hours=zone_input.hours, minutes=zone_input.minutes, seconds=zone_input.seconds,
        )
    elif zone_input.type == "volume":
        x1_val = zone_input.x_min if zone_input.x_min is not None else 0
        x2_val = zone_input.x_max if zone_input.x_max is not None else room.x
        x1_val, x2_val = min(x1_val, x2_val), max(x1_val, x2_val)
        y1_val = zone_input.y_min if zone_input.y_min is not None else 0
        y2_val = zone_input.y_max if zone_input.y_max is not None else room.y
        y1_val, y2_val = min(y1_val, y2_val), max(y1_val, y2_val)
        z1_val = zone_input.z_min if zone_input.z_min is not None else 0
        z2_val = zone_input.z_max if zone_input.z_max is not None else room.z
        z1_val, z2_val = min(z1_val, z2_val), max(z1_val, z2_val)

        grid_kwargs = {}
        if zone_input.num_x is not None and zone_input.num_y is not None and zone_input.num_z is not None:
            grid_kwargs["num_points_init"] = (zone_input.num_x, zone_input.num_y, zone_input.num_z)
        elif zone_input.x_spacing is not None and zone_input.y_spacing is not None and zone_input.z_spacing is not None:
            grid_kwargs["spacing_init"] = (zone_input.x_spacing, zone_input.y_spacing, zone_input.z_spacing)
        if zone_input.offset is not None:
            grid_kwargs["offset"] = zone_input.offset

        geometry = VolumeGrid.from_legacy(
            mins=(x1_val, y1_val, z1_val),
            maxs=(x2_val, y2_val, z2_val),
            **grid_kwargs,
        )
        zone = CalcVol(
            zone_id=zone_input.id, name=zone_input.name,
            geometry=geometry,
            dose=zone_input.dose,
            hours=zone_input.hours, minutes=zone_input.minutes, seconds=zone_input.seconds,
        )
    else:
        raise HTTPException(status_code=400, detail=f"Unknown zone type: {zone_input.type}")

    zone.enabled = zone_input.enabled
    zone.visible = getattr(zone_input, 'visible', True)
    if hasattr(zone_input, 'display_mode') and zone_input.display_mode is not None:
        zone.display_mode = zone_input.display_mode
    if hasattr(zone_input, 'contour_settings') and zone_input.contour_settings is not None:
        zone.contour_settings = zone_input.contour_settings
    return zone


def _lamp_to_loaded(lamp, lamp_id: str):
    """Convert a guv_calcs Lamp to LoadedLamp response"""

    lamp_type = _guv_type_to_frontend(lamp)

    has_ies = lamp.ies is not None
    has_spectrum = lamp.spectrum is not None

    # Detect custom lamps: has IES data but no recognized preset.
    # Handles .guv files saved before preset_id="custom" was stored.
    preset_id = getattr(lamp, 'preset_id', None)
    if preset_id is None and has_ies:
        preset_id = "custom"

    return LoadedLamp(
        id=lamp_id,
        lamp_type=lamp_type,
        preset_id=preset_id,
        name=getattr(lamp, 'name', None),
        x=lamp.x, y=lamp.y, z=lamp.z,
        angle=getattr(lamp, 'angle', 0.0),
        aimx=lamp.aimx, aimy=lamp.aimy, aimz=lamp.aimz,
        tilt=getattr(lamp, 'bank', 0.0),
        orientation=getattr(lamp, 'heading', 0.0),
        scaling_factor=lamp.scaling_factor,
        enabled=getattr(lamp, 'enabled', True),
        visible=getattr(lamp, 'visible', True),
        has_ies_file=has_ies,
        has_spectrum_file=has_spectrum,
    )


def _zone_to_loaded(zone, zone_id: str):
    """Convert a guv_calcs CalcPlane/CalcVol to LoadedZone response"""

    zone_type = zone.calctype.lower()

    h, m, s = _decompose_time(zone)
    loaded = LoadedZone(
        id=zone_id,
        name=getattr(zone, 'name', None),
        type=zone_type,
        enabled=getattr(zone, 'enabled', True),
        visible=getattr(zone, 'visible', True),
        is_standard=zone_id in (EYE_LIMITS, SKIN_LIMITS, WHOLE_ROOM_FLUENCE),
        num_x=getattr(zone, 'num_x', None),
        num_y=getattr(zone, 'num_y', None),
        x_spacing=getattr(zone, 'x_spacing', None),
        y_spacing=getattr(zone, 'y_spacing', None),
        offset=getattr(zone, 'offset', None),
        dose=getattr(zone, 'dose', None),
        hours=h, minutes=m, seconds=s,
        display_mode=getattr(zone, 'display_mode', 'heatmap'),
        contour_settings=getattr(zone, 'contour_settings', None),
    )

    if zone_type == "plane":
        loaded.calc_mode = zone.calc_mode
        loaded.height = getattr(zone, 'height', None)
        loaded.x1 = getattr(zone, 'x1', None)
        loaded.x2 = getattr(zone, 'x2', None)
        loaded.y1 = getattr(zone, 'y1', None)
        loaded.y2 = getattr(zone, 'y2', None)
        loaded.ref_surface = getattr(zone, 'ref_surface', None)
        loaded.direction = getattr(zone, 'direction', None)
        loaded.horiz = getattr(zone, 'horiz', None)
        loaded.vert = getattr(zone, 'vert', None)
        loaded.use_normal = getattr(zone, 'use_normal', None)
        loaded.fov_vert = getattr(zone, 'fov_vert', None)
        loaded.fov_horiz = getattr(zone, 'fov_horiz', None)
        loaded.view_direction = getattr(zone, 'view_direction', None)
        loaded.view_target = getattr(zone, 'view_target', None)
        v_hat = getattr(zone.geometry, 'v_hat', None)
        if v_hat is not None:
            abs_v = np.abs(v_hat)
            v_idx = int(np.argmax(abs_v))
            loaded.v_positive_direction = bool(v_hat[v_idx] > 0)
    elif zone_type == "point":
        loaded.x = zone.position[0]
        loaded.y = zone.position[1]
        loaded.z = zone.position[2]
        loaded.aim_x = zone.aim_point[0]
        loaded.aim_y = zone.aim_point[1]
        loaded.aim_z = zone.aim_point[2]
        loaded.horiz = getattr(zone, 'horiz', None)
        loaded.vert = getattr(zone, 'vert', None)
        loaded.fov_vert = getattr(zone, 'fov_vert', None)
        loaded.fov_horiz = getattr(zone, 'fov_horiz', None)
        loaded.calc_mode = getattr(zone, 'calc_mode', None)
    else:
        loaded.num_z = getattr(zone, 'num_z', None)
        loaded.z_spacing = getattr(zone, 'z_spacing', None)
        loaded.x_min = getattr(zone, 'x1', None)
        loaded.x_max = getattr(zone, 'x2', None)
        loaded.y_min = getattr(zone, 'y1', None)
        loaded.y_max = getattr(zone, 'y2', None)
        loaded.z_min = getattr(zone, 'z1', None)
        loaded.z_max = getattr(zone, 'z2', None)

    return loaded


def _format_exposure(td) -> str:
    """Format a timedelta or number of seconds as a human-readable exposure label."""
    if td is None:
        return ""
    if isinstance(td, (int, float)):
        import datetime
        td = datetime.timedelta(seconds=td)
    secs = td.total_seconds()
    if secs >= 3600 and secs % 3600 == 0:
        n = int(secs // 3600)
        return f"{n} Hour"
    if secs >= 60 and secs % 60 == 0:
        n = int(secs // 60)
        return f"{n} Minute"
    return f"{secs:g} Second"


def get_asset_path(src: str):
    import os
    from pathlib import Path
    if src.startswith("/") or src.startswith("\\"):
        src = src.lstrip("/\\")
    # Search in ui/static or workspace root
    base_dir = Path(__file__).resolve().parents[3]
    path1 = base_dir / "ui" / "static" / src
    if path1.exists():
        return path1
    path2 = base_dir / src
    if path2.exists():
        return path2
    return None


def load_overlay_image(overlay):
    import base64
    import io
    from pathlib import Path
    from PIL import Image as PILImage

    # Retrieve field value, supporting both dict and object
    def get_field(obj, name, default=None):
        if isinstance(obj, dict):
            return obj.get(name, default)
        return getattr(obj, name, default)

    comp_path = get_field(overlay, 'computer_path')
    if comp_path:
        p = Path(comp_path)
        if p.exists():
            try:
                return PILImage.open(p)
            except Exception as e:
                logger.warning(f"Failed to load image from computer_path {comp_path}: {e}")
                
    src = get_field(overlay, 'src', '')
    if src.startswith("data:image/"):
        try:
            parts = src.split(",", 1)
            if len(parts) == 2:
                data = base64.b64decode(parts[1])
                return PILImage.open(io.BytesIO(data))
        except Exception as e:
            logger.warning(f"Failed to decode base64 overlay image: {e}")
            
    asset_path = get_asset_path(src)
    if asset_path:
        try:
            return PILImage.open(asset_path)
        except Exception as e:
            logger.warning(f"Failed to load image from asset_path {asset_path}: {e}")
            
    return None


BUILT_IN_PRESETS = {
    'Eye limits irradiance': {
        'levels': '0.7, 1.06, 2.13, 3.2, 5.33, 10.6',
        'labels': 'ICNIRP, 20% ACGIH, 40% ACGIH, 60% ACGIH, 100% ACGIH, ACGIH 4hrs',
        'colors': '#2ED13B, #BFF000, #FFD400, #FF8A00, #FF1A1A, #C400E0',
        'floorColor': '#00A24A'
    },
    'Skin limits irradiance': {
        'levels': '0.7, 3.2, 6.4, 9.6, 15.9, 32',
        'labels': 'ICNIRP, 20% ACGIH, 40% ACGIH, 60% ACGIH, 100% ACGIH, ACGIH 4hrs',
        'colors': '#2ED13B, #BFF000, #FFD400, #FF8A00, #FF1A1A, #C400E0',
        'floorColor': '#00A24A'
    },
    'Eye limits Dose': {
        'levels': '23, 32, 64, 96, 161, 322',
        'labels': 'ICNIRP, 20% ACGIH, 40% ACGIH, 60% ACGIH, 100% ACGIH, ACGIH 4hrs',
        'colors': '#2ED13B, #BFF000, #FFD400, #FF8A00, #FF1A1A, #C400E0',
        'floorColor': '#00A24A'
    },
    'Skin limits dose': {
        'levels': '23, 96, 192, 287, 479, 958',
        'labels': 'ICNIRP, 20% ACGIH, 40% ACGIH, 60% ACGIH, 100% ACGIH, ACGIH 4hrs',
        'colors': '#2ED13B, #BFF000, #FFD400, #FF8A00, #FF1A1A, #C400E0',
        'floorColor': '#00A24A'
    }
}


def get_default_preset_name(zone):
    name = (getattr(zone, 'name', None) or getattr(zone, 'id', None) or '').lower()
    is_dose = 'dose' in name or getattr(zone, 'dose', False)
    is_skin = 'skin' in name
    is_eye = 'eye' in name

    if is_dose:
        if is_skin:
            return 'Skin limits dose'
        if is_eye:
            return 'Eye limits Dose'
        return 'Eye limits Dose'
    else:
        if is_skin:
            return 'Skin limits irradiance'
        if is_eye:
            return 'Eye limits irradiance'
        return 'Eye limits irradiance'


def generate_contour_plot(zone, room=None, theme="light", dpi=100, units="meters"):
    """
    Generate a contour plot for a Plane zone using Matplotlib.
    Applies floorColor, levels, colors, filled, grid, contourLabels, equalAspect, and overlays.

    If `room` is given and is a polygon room, the plotted contours are clipped
    to the room's actual footprint -- a zone's own geometry may be a plain
    rectangle even when it sits inside a non-rectangular room (e.g. a
    zone spanning the full bounding box of an L-shaped room), so this can't
    be inferred from the zone's own geometry alone. Matches the clipping the
    frontend's own canvas-based contour renderer already applies.
    """
    import matplotlib.pyplot as plt
    from matplotlib.path import Path as MplPath
    from matplotlib.patches import PathPatch, Patch
    import numpy as np
    from PIL import Image as PILImage

    settings = getattr(zone, 'contour_settings', None)
    values = zone.get_values()
    if values is None:
        return None
        
    # Helper to read settings fields from dict/Pydantic
    def get_field(obj, name, default=None):
        if obj is None:
            return default
        if isinstance(obj, dict):
            return obj.get(name, default)
        return getattr(obj, name, default)

    default_preset_name = get_default_preset_name(zone)
    default_preset = BUILT_IN_PRESETS.get(default_preset_name)

    levels_str = get_field(settings, 'levels')
    if not levels_str or not str(levels_str).strip():
        levels_str = default_preset['levels']
    
    levels = []
    for s in str(levels_str).split(','):
        if s.strip():
            try:
                levels.append(float(s.strip()))
            except ValueError:
                pass
    levels = sorted(list(set(levels)))
    if not levels:
        levels = [float(s.strip()) for s in default_preset['levels'].split(',')]

    colors_str = get_field(settings, 'colors')
    if not colors_str or not str(colors_str).strip():
        colors_str = default_preset['colors']
    colors = [s.strip() for s in str(colors_str).split(',') if s.strip()]

    floor_color = get_field(settings, 'floorColor')
    if not floor_color or not str(floor_color).strip():
        floor_color = default_preset['floorColor']

    filled = get_field(settings, 'filled')
    if filled is None:
        filled = True

    grid = get_field(settings, 'grid')
    if grid is None:
        grid = True

    contour_labels = get_field(settings, 'contourLabels')
    if contour_labels is None:
        contour_labels = True

    equal_aspect = get_field(settings, 'equalAspect')
    if equal_aspect is None:
        equal_aspect = True

    fig, ax = plt.subplots(figsize=(10, 8))
    
    geom = zone.geometry
    u_hat = getattr(geom, 'u_hat', None)
    v_hat = getattr(geom, 'v_hat', None)
    
    if u_hat is not None and v_hat is not None:
        def get_axis_label(vec):
            abs_vec = np.abs(vec)
            idx = int(np.argmax(abs_vec))
            if abs_vec[idx] > 0.9:
                return ['X', 'Y', 'Z'][idx]
            return None
            
        u_label = get_axis_label(u_hat) or 'U'
        v_label = get_axis_label(v_hat) or 'V'
        
        mins = geom.mins
        maxs = geom.maxs
        extent = [mins[0], maxs[0], mins[1], maxs[1]]
        v_positive = v_hat[int(np.argmax(np.abs(v_hat)))] > 0
    else:
        u_label = 'X'
        v_label = 'Y'
        extent = [geom.x1, geom.x2, geom.y1, geom.y2]
        v_positive = True

    u1, u2, v1, v2 = extent
    if hasattr(geom, 'values_to_grid'):
        plot_values = geom.values_to_grid(values).T
    elif hasattr(zone, 'num_points'):
        plot_values = values.reshape(zone.num_points).T
    else:
        plot_values = values.T
    
    if not v_positive:
        plot_values = plot_values[::-1]

    num_y, num_x = plot_values.shape
    x_coords = np.linspace(u1, u2, num_x)
    y_coords = np.linspace(v1, v2, num_y)
    X_grid, Y_grid = np.meshgrid(x_coords, y_coords)

    levels_str = get_field(settings, 'levels', '')
    levels = [float(s.strip()) for s in levels_str.split(',') if s.strip()]
    levels = sorted(list(set(levels)))
    
    colors_str = get_field(settings, 'colors', '')
    colors = [s.strip() for s in colors_str.split(',') if s.strip()]

    labels_str = get_field(settings, 'labels', '')
    labels = [s.strip() for s in labels_str.split(',') if s.strip()]

    floor_color = get_field(settings, 'floorColor', '#00A24A')
    filled = get_field(settings, 'filled', True)
    grid = get_field(settings, 'grid', True)
    contour_labels = get_field(settings, 'contourLabels', True)
    equal_aspect = get_field(settings, 'equalAspect', True)

    # Clip path matching the room's actual (possibly non-rectangular) footprint.
    # Only applies to floor/ceiling-plane zones (ref_surface "xy"), matching the
    # frontend's traceRoomPolygon() clip -- walls aren't clipped this way.
    room_clip_patch = None
    ref_surface = getattr(zone.geometry, 'ref_surface', None) or 'xy'
    if room is not None and getattr(room, 'polygon', None) is not None and ref_surface == 'xy':
        verts = list(room.polygon.vertices)
        verts.append(verts[0])
        codes = (
            [MplPath.MOVETO]
            + [MplPath.LINETO] * (len(verts) - 2)
            + [MplPath.CLOSEPOLY]
        )
        room_clip_patch = PathPatch(
            MplPath(verts, codes), transform=ax.transData, facecolor='none', edgecolor='none'
        )
        ax.add_patch(room_clip_patch)

    if filled:
        max_val = np.max(plot_values) if plot_values.size > 0 else 0
        upper_bound = max(max_val * 1.1 + 0.1, levels[-1] * 1.1 + 0.1) if levels else 1e9
        cnt_levels = [0.0] + levels + [upper_bound]
        cnt_colors = [floor_color] + colors
        n_intervals = len(cnt_levels) - 1
        if len(cnt_colors) < n_intervals:
            cnt_colors += ['#cccccc'] * (n_intervals - len(cnt_colors))
        elif len(cnt_colors) > n_intervals:
            cnt_colors = cnt_colors[:n_intervals]
            
        cf = ax.contourf(X_grid, Y_grid, plot_values, levels=cnt_levels, colors=cnt_colors)
        if room_clip_patch is not None:
            cf.set_clip_path(room_clip_patch)
    else:
        bg_col = '#1a1a2e' if theme == 'dark' else '#ffffff'
        ax.set_facecolor(bg_col)

    stroke_color = 'rgba(255,255,255,0.7)' if theme == 'dark' else 'rgba(20,22,28,0.75)'
    if isinstance(stroke_color, str) and stroke_color.startswith('rgba'):
        parts = stroke_color.replace('rgba(', '').replace(')', '').split(',')
        stroke_color = (float(parts[0])/255, float(parts[1])/255, float(parts[2])/255, float(parts[3]))
        
    cs = ax.contour(X_grid, Y_grid, plot_values, levels=levels, colors=[stroke_color], linewidths=1.0)
    if room_clip_patch is not None:
        cs.set_clip_path(room_clip_patch)

    if contour_labels and len(levels) > 0:
        lbl_color = '#dddddd' if theme == 'dark' else '#222222'
        ax.clabel(cs, inline=True, fontsize=8, colors=lbl_color, fmt=lambda x: f"{x:g}")

    if grid:
        grid_color = 'rgba(255,255,255,0.15)' if theme == 'dark' else 'rgba(0,0,0,0.15)'
        if isinstance(grid_color, str) and grid_color.startswith('rgba'):
            parts = grid_color.replace('rgba(', '').replace(')', '').split(',')
            grid_color = (float(parts[0])/255, float(parts[1])/255, float(parts[2])/255, float(parts[3]))
        ax.grid(True, which='both', color=grid_color, linestyle='--', linewidth=0.5)
    else:
        ax.grid(False)

    overlays = get_field(settings, 'overlays', [])
    for o in overlays:
        img = load_overlay_image(o)
        if img is None:
            continue
            
        opacity = get_field(o, 'opacity', 1.0)
        rot = get_field(o, 'rot', 0.0)
        relX = get_field(o, 'relX', 0.5)
        relY = get_field(o, 'relY', 0.5)
        relW = get_field(o, 'relW', 0.2)
        relH = get_field(o, 'relH', 0.2)
        
        img = img.convert("RGBA")
        if opacity < 1.0:
            r, g, b, a = img.split()
            a = a.point(lambda p: int(p * opacity))
            img = PILImage.merge("RGBA", (r, g, b, a))
            
        if rot != 0:
            img = img.rotate(-rot, expand=True, resample=PILImage.Resampling.BILINEAR)
            
        center_u = u1 + relX * (u2 - u1)
        center_v = v1 + (1.0 - relY) * (v2 - v1)
        
        w_units = relW * (u2 - u1)
        h_units = relH * (v2 - v1)
        
        img_orig = load_overlay_image(o)
        if img_orig:
            W_orig, H_orig = img_orig.size
            scale_u = w_units / W_orig
            scale_v = h_units / H_orig
            W, H = img.size
            w_box = W * scale_u
            h_box = H * scale_v
        else:
            w_box, h_box = w_units, h_units
            
        overlay_extent = [
            center_u - w_box / 2,
            center_u + w_box / 2,
            center_v - h_box / 2,
            center_v + h_box / 2
        ]
        
        ax.imshow(img, extent=overlay_extent, origin='lower', zorder=4)

    ax.set_xlim(u1, u2)
    ax.set_ylim(v1, v2)
    ax.set_xlabel(f"{u_label} ({units})")
    ax.set_ylabel(f"{v_label} ({units})")
    
    title = f"{zone.name} - Contours"
    if zone.dose:
        title += f" ({_format_exposure(zone.exposure_time)} Dose)"
    else:
        title += " (Irradiance)"
    title += f" ({zone.height} {units})"
    ax.set_title(title)

    if equal_aspect:
        ax.set_aspect('equal')

    # Legend mapping each level's color to its (named) label, matching the
    # frontend's colorbar-with-labels -- this was previously missing entirely,
    # leaving only the inline numeric contour-line labels (contour_labels).
    if levels:
        legend_handles = [
            Patch(
                facecolor=colors[i] if i < len(colors) else '#cccccc',
                edgecolor='none',
                label=labels[i] if i < len(labels) else f"≥ {levels[i]:g}",
            )
            for i in range(len(levels) - 1, -1, -1)
        ]
        ax.legend(
            handles=legend_handles,
            loc='center left',
            bbox_to_anchor=(1.02, 0.5),
            frameon=False,
            fontsize=9,
            handlelength=1.2,
            handleheight=1.2,
        )

    return fig, ax



