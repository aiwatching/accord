package com.example.devicemanager.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.ArrayList;
import java.util.List;

public class BatchDeleteResponse {

    private boolean success;
    private List<String> deleted;
    private List<BatchDeleteError> failed;

    @JsonProperty("total_requested")
    private int totalRequested;

    @JsonProperty("total_deleted")
    private int totalDeleted;

    public BatchDeleteResponse() {
        this.deleted = new ArrayList<>();
        this.failed = new ArrayList<>();
    }

    public BatchDeleteResponse(boolean success, List<String> deleted, List<BatchDeleteError> failed,
                               int totalRequested, int totalDeleted) {
        this.success = success;
        this.deleted = deleted;
        this.failed = failed;
        this.totalRequested = totalRequested;
        this.totalDeleted = totalDeleted;
    }

    public boolean isSuccess() {
        return success;
    }

    public void setSuccess(boolean success) {
        this.success = success;
    }

    public List<String> getDeleted() {
        return deleted;
    }

    public void setDeleted(List<String> deleted) {
        this.deleted = deleted;
    }

    public List<BatchDeleteError> getFailed() {
        return failed;
    }

    public void setFailed(List<BatchDeleteError> failed) {
        this.failed = failed;
    }

    public int getTotalRequested() {
        return totalRequested;
    }

    public void setTotalRequested(int totalRequested) {
        this.totalRequested = totalRequested;
    }

    public int getTotalDeleted() {
        return totalDeleted;
    }

    public void setTotalDeleted(int totalDeleted) {
        this.totalDeleted = totalDeleted;
    }

    public static class BatchDeleteError {
        @JsonProperty("device_id")
        private String deviceId;
        private String error;

        public BatchDeleteError() {}

        public BatchDeleteError(String deviceId, String error) {
            this.deviceId = deviceId;
            this.error = error;
        }

        public String getDeviceId() {
            return deviceId;
        }

        public void setDeviceId(String deviceId) {
            this.deviceId = deviceId;
        }

        public String getError() {
            return error;
        }

        public void setError(String error) {
            this.error = error;
        }
    }
}
