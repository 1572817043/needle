use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DeleteErrorCode {
    DbNotReady,
    DbError,
    PermissionDenied,
    FileDeleteFailed,
    InternalError,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResult {
    pub song_id: String,
    pub file_deleted: Option<bool>,
    pub db_row_deleted: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeleteError {
    pub code: DeleteErrorCode,
    pub message: String,
    pub path: Option<String>,
    pub os_error: Option<String>,
}

impl DeleteError {
    pub fn db_not_ready(message: impl Into<String>) -> Self {
        Self {
            code: DeleteErrorCode::DbNotReady,
            message: message.into(),
            path: None,
            os_error: None,
        }
    }

    pub fn db_error(message: impl Into<String>) -> Self {
        Self {
            code: DeleteErrorCode::DbError,
            message: message.into(),
            path: None,
            os_error: None,
        }
    }

    pub fn permission_denied(
        message: impl Into<String>,
        path: impl Into<String>,
        os_error: impl Into<String>,
    ) -> Self {
        Self {
            code: DeleteErrorCode::PermissionDenied,
            message: message.into(),
            path: Some(path.into()),
            os_error: Some(os_error.into()),
        }
    }

    pub fn file_delete_failed(
        message: impl Into<String>,
        path: impl Into<String>,
        os_error: impl Into<String>,
    ) -> Self {
        Self {
            code: DeleteErrorCode::FileDeleteFailed,
            message: message.into(),
            path: Some(path.into()),
            os_error: Some(os_error.into()),
        }
    }

    pub fn internal_error(message: impl Into<String>) -> Self {
        Self {
            code: DeleteErrorCode::InternalError,
            message: message.into(),
            path: None,
            os_error: None,
        }
    }
}
