package com.example.devicemanager.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

public class AllInterfacesResponse {

    @JsonProperty("interfaces")
    private List<InterfaceWithDevice> interfaces;

    @JsonProperty("pagination")
    private PaginationMetadata pagination;

    public AllInterfacesResponse() {}

    public AllInterfacesResponse(List<InterfaceWithDevice> interfaces, PaginationMetadata pagination) {
        this.interfaces = interfaces;
        this.pagination = pagination;
    }

    public List<InterfaceWithDevice> getInterfaces() { return interfaces; }
    public void setInterfaces(List<InterfaceWithDevice> interfaces) { this.interfaces = interfaces; }

    public PaginationMetadata getPagination() { return pagination; }
    public void setPagination(PaginationMetadata pagination) { this.pagination = pagination; }
}
