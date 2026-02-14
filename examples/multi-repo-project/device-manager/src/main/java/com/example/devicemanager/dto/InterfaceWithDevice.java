package com.example.devicemanager.dto;

import com.example.devicemanager.model.InterfaceStatus;
import com.example.devicemanager.model.InterfaceType;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;

public class InterfaceWithDevice {

    @JsonProperty("id")
    private String id;

    @JsonProperty("deviceId")
    private String deviceId;

    @JsonProperty("deviceName")
    private String deviceName;

    @JsonProperty("name")
    private String name;

    @JsonProperty("type")
    private InterfaceType type;

    @JsonProperty("macAddress")
    private String macAddress;

    @JsonProperty("ipAddress")
    private String ipAddress;

    @JsonProperty("status")
    private InterfaceStatus status;

    @JsonProperty("enabled")
    private Boolean enabled;

    @JsonProperty("createdAt")
    private Instant createdAt;

    @JsonProperty("updatedAt")
    private Instant updatedAt;

    public InterfaceWithDevice() {}

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public String getDeviceId() { return deviceId; }
    public void setDeviceId(String deviceId) { this.deviceId = deviceId; }

    public String getDeviceName() { return deviceName; }
    public void setDeviceName(String deviceName) { this.deviceName = deviceName; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public InterfaceType getType() { return type; }
    public void setType(InterfaceType type) { this.type = type; }

    public String getMacAddress() { return macAddress; }
    public void setMacAddress(String macAddress) { this.macAddress = macAddress; }

    public String getIpAddress() { return ipAddress; }
    public void setIpAddress(String ipAddress) { this.ipAddress = ipAddress; }

    public InterfaceStatus getStatus() { return status; }
    public void setStatus(InterfaceStatus status) { this.status = status; }

    public Boolean getEnabled() { return enabled; }
    public void setEnabled(Boolean enabled) { this.enabled = enabled; }

    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }

    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
}
