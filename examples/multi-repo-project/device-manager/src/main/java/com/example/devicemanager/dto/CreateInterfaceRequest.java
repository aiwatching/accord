package com.example.devicemanager.dto;

import com.example.devicemanager.model.InterfaceType;
import com.fasterxml.jackson.annotation.JsonProperty;

public class CreateInterfaceRequest {

    @JsonProperty("name")
    private String name;

    @JsonProperty("type")
    private InterfaceType type;

    @JsonProperty("macAddress")
    private String macAddress;

    @JsonProperty("ipAddress")
    private String ipAddress;

    @JsonProperty("enabled")
    private Boolean enabled;

    public CreateInterfaceRequest() {}

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public InterfaceType getType() { return type; }
    public void setType(InterfaceType type) { this.type = type; }

    public String getMacAddress() { return macAddress; }
    public void setMacAddress(String macAddress) { this.macAddress = macAddress; }

    public String getIpAddress() { return ipAddress; }
    public void setIpAddress(String ipAddress) { this.ipAddress = ipAddress; }

    public Boolean getEnabled() { return enabled; }
    public void setEnabled(Boolean enabled) { this.enabled = enabled; }
}
