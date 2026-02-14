package com.example.devicemanager.model;

import java.time.Instant;

public class NetworkInterface {

    private String id;
    private String deviceId;
    private String name;
    private InterfaceType type;
    private String macAddress;
    private String ipAddress;
    private InterfaceStatus status;
    private Boolean enabled;
    private Instant createdAt;
    private Instant updatedAt;

    public NetworkInterface() {}

    public NetworkInterface(String id, String deviceId, String name, InterfaceType type,
                           String macAddress, String ipAddress, InterfaceStatus status, Boolean enabled) {
        this.id = id;
        this.deviceId = deviceId;
        this.name = name;
        this.type = type;
        this.macAddress = macAddress;
        this.ipAddress = ipAddress;
        this.status = status;
        this.enabled = enabled;
        this.createdAt = Instant.now();
        this.updatedAt = Instant.now();
    }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public String getDeviceId() { return deviceId; }
    public void setDeviceId(String deviceId) { this.deviceId = deviceId; }

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
