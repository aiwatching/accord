package com.example.devicemanager.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

public class BatchDeleteRequest {

    @JsonProperty("device_ids")
    private List<String> deviceIds;

    public BatchDeleteRequest() {}

    public BatchDeleteRequest(List<String> deviceIds) {
        this.deviceIds = deviceIds;
    }

    public List<String> getDeviceIds() {
        return deviceIds;
    }

    public void setDeviceIds(List<String> deviceIds) {
        this.deviceIds = deviceIds;
    }
}
